import { asc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "../../../db/index.ts";
import {
  category as categoryTable,
  ingredient,
  ingredientAlias,
  recipeIngredient,
} from "../../../db/schema.ts";
import { getImpact } from "../shared/impact.ts";
import { linkedRecipesForIngredients } from "../shared/linked-recipes.ts";
import { runMerge, MergeError, type MergeResult } from "../shared/merge.ts";
import type { ImpactRow, Tx } from "../shared/types.ts";
import {
  dedupeAliasesIgnoreCase,
  findNameCollision,
  normalizeName,
  validateName,
} from "../shared/validation.ts";
import { ingredientAdapter, type IngredientRow } from "./adapter.ts";

export type IngredientListItem = {
  id: number;
  name: string;
  aliases: string[];
  defaultCategoryId: number | null;
  defaultCategoryName: string | null;
  excludeFromShoppingList: boolean;
  dietaryClass: "vegan" | "vegetarian" | "meat" | null;
  recipeRefCount: number;
};

export type IngredientDetail = IngredientListItem;

export type IngredientUpsertInput = {
  name: string;
  aliases: string[];
  defaultCategoryId: number | null;
  excludeFromShoppingList: boolean;
  dietaryClass: "vegan" | "vegetarian" | "meat" | null;
};

export class StammdatenError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "StammdatenError";
    this.status = status;
  }
}

const nowSec = () => Math.floor(Date.now() / 1000);

function selectIngredientWithJoinedData(query?: string) {
  const base = db
    .select({
      id: ingredient.id,
      name: ingredient.name,
      defaultCategoryId: ingredient.defaultCategoryId,
      defaultCategoryName: categoryTable.name,
      excludeFromShoppingList: ingredient.excludeFromShoppingList,
      dietaryClass: ingredient.dietaryClass,
    })
    .from(ingredient)
    .leftJoin(categoryTable, eq(categoryTable.id, ingredient.defaultCategoryId));

  if (!query || query.trim().length === 0) {
    return base.orderBy(asc(ingredient.name)).all();
  }
  const lowered = query.trim().toLowerCase();
  const pattern = `%${lowered.replace(/[%_]/g, "\\$&")}%`;
  // Match against canonical name OR any alias name (case-insensitive).
  const aliasMatchIds = db
    .select({ id: ingredientAlias.ingredientId })
    .from(ingredientAlias)
    .where(sql`lower_u(${ingredientAlias.name}) LIKE ${pattern}`);
  return base
    .where(
      or(
        sql`lower_u(${ingredient.name}) LIKE ${pattern}`,
        inArray(ingredient.id, aliasMatchIds),
      ),
    )
    .orderBy(asc(ingredient.name))
    .all();
}

function loadAliasesGrouped(ids: number[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  if (ids.length === 0) return out;
  const rows = db
    .select({
      ingredientId: ingredientAlias.ingredientId,
      name: ingredientAlias.name,
    })
    .from(ingredientAlias)
    .where(inArray(ingredientAlias.ingredientId, ids))
    .orderBy(asc(ingredientAlias.name))
    .all();
  for (const row of rows) {
    const list = out.get(row.ingredientId) ?? [];
    list.push(row.name);
    out.set(row.ingredientId, list);
  }
  return out;
}

function loadRecipeRefCounts(ids: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const rows = db
    .select({
      id: recipeIngredient.ingredientId,
      count: sql<number>`count(*)`,
    })
    .from(recipeIngredient)
    .where(inArray(recipeIngredient.ingredientId, ids))
    .groupBy(recipeIngredient.ingredientId)
    .all();
  for (const row of rows) out.set(row.id, Number(row.count));
  return out;
}

export function listIngredients(query?: string): IngredientListItem[] {
  const baseRows = selectIngredientWithJoinedData(query);
  const ids = baseRows.map((r) => r.id);
  const aliases = loadAliasesGrouped(ids);
  const recipeCounts = loadRecipeRefCounts(ids);
  return baseRows.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: aliases.get(row.id) ?? [],
    defaultCategoryId: row.defaultCategoryId,
    defaultCategoryName: row.defaultCategoryName,
    excludeFromShoppingList: row.excludeFromShoppingList,
    dietaryClass: row.dietaryClass,
    recipeRefCount: recipeCounts.get(row.id) ?? 0,
  }));
}

export function getIngredientDetail(id: number): IngredientDetail | null {
  const list = listIngredientsByIds([id]);
  return list[0] ?? null;
}

function listIngredientsByIds(ids: number[]): IngredientListItem[] {
  if (ids.length === 0) return [];
  const baseRows = db
    .select({
      id: ingredient.id,
      name: ingredient.name,
      defaultCategoryId: ingredient.defaultCategoryId,
      defaultCategoryName: categoryTable.name,
      excludeFromShoppingList: ingredient.excludeFromShoppingList,
      dietaryClass: ingredient.dietaryClass,
    })
    .from(ingredient)
    .leftJoin(categoryTable, eq(categoryTable.id, ingredient.defaultCategoryId))
    .where(inArray(ingredient.id, ids))
    .all();
  const aliases = loadAliasesGrouped(ids);
  const recipeCounts = loadRecipeRefCounts(ids);
  return baseRows.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: aliases.get(row.id) ?? [],
    defaultCategoryId: row.defaultCategoryId,
    defaultCategoryName: row.defaultCategoryName,
    excludeFromShoppingList: row.excludeFromShoppingList,
    dietaryClass: row.dietaryClass,
    recipeRefCount: recipeCounts.get(row.id) ?? 0,
  }));
}

function validateInput(
  input: IngredientUpsertInput,
  excludeId?: number,
): { name: string; aliases: string[] } {
  const nameError = validateName(input.name);
  if (nameError) throw new StammdatenError(nameError);
  const cleanedName = normalizeName(input.name);

  const aliasResult = dedupeAliasesIgnoreCase(input.aliases, cleanedName);
  if (aliasResult.error) throw new StammdatenError(aliasResult.error);
  const cleanedAliases = aliasResult.aliases;

  // Cross-namespace check: canonical name unique across canonical + alias.
  const nameCollision = findNameCollision({
    name: cleanedName,
    canonicalTable: ingredient,
    canonicalIdColumn: ingredient.id,
    canonicalNameColumn: ingredient.name,
    aliasTable: ingredientAlias,
    aliasParentColumn: ingredientAlias.ingredientId,
    aliasNameColumn: ingredientAlias.name,
    excludeCanonicalId: excludeId,
    excludeAliasParentId: excludeId,
  });
  if (nameCollision) {
    throw new StammdatenError(
      `Der Name "${cleanedName}" ist bereits vergeben (${
        nameCollision.kind === "canonical" ? "als Zutat" : "als Alias"
      }: "${nameCollision.name}").`,
      409,
    );
  }

  for (const alias of cleanedAliases) {
    const collision = findNameCollision({
      name: alias,
      canonicalTable: ingredient,
      canonicalIdColumn: ingredient.id,
      canonicalNameColumn: ingredient.name,
      aliasTable: ingredientAlias,
      aliasParentColumn: ingredientAlias.ingredientId,
      aliasNameColumn: ingredientAlias.name,
      excludeCanonicalId: excludeId,
      excludeAliasParentId: excludeId,
    });
    if (collision) {
      throw new StammdatenError(
        `Alias "${alias}" ist bereits vergeben (${
          collision.kind === "canonical" ? "als Zutat" : "als Alias"
        }: "${collision.name}").`,
        409,
      );
    }
  }

  return { name: cleanedName, aliases: cleanedAliases };
}

export function createIngredient(input: IngredientUpsertInput): IngredientDetail {
  const { name, aliases } = validateInput(input);
  const detail = db.transaction((tx) => {
    const inserted = tx
      .insert(ingredient)
      .values({
        name,
        defaultCategoryId: input.defaultCategoryId ?? null,
        excludeFromShoppingList: input.excludeFromShoppingList,
        dietaryClass: input.dietaryClass,
      })
      .returning({ id: ingredient.id })
      .all();
    const newId = inserted[0].id;
    if (aliases.length > 0) {
      tx.insert(ingredientAlias)
        .values(aliases.map((name) => ({ ingredientId: newId, name })))
        .run();
    }
    return newId;
  });
  return getIngredientDetail(detail) ?? unreachable();
}

export function updateIngredient(
  id: number,
  input: IngredientUpsertInput,
): IngredientDetail {
  const existing = db
    .select({ id: ingredient.id })
    .from(ingredient)
    .where(eq(ingredient.id, id))
    .get();
  if (!existing) throw new StammdatenError("Zutat nicht gefunden.", 404);

  const { name, aliases } = validateInput(input, id);

  db.transaction((tx) => {
    tx.update(ingredient)
      .set({
        name,
        defaultCategoryId: input.defaultCategoryId ?? null,
        excludeFromShoppingList: input.excludeFromShoppingList,
        dietaryClass: input.dietaryClass,
        updatedAt: nowSec(),
      })
      .where(eq(ingredient.id, id))
      .run();
    tx.delete(ingredientAlias)
      .where(eq(ingredientAlias.ingredientId, id))
      .run();
    if (aliases.length > 0) {
      tx.insert(ingredientAlias)
        .values(aliases.map((name) => ({ ingredientId: id, name })))
        .run();
    }
  });

  return getIngredientDetail(id) ?? unreachable();
}

export type IngredientDeleteResult = {
  deletedId: number;
  replacedWith?: number;
};

export function deleteIngredient(
  id: number,
  replaceWith?: number,
): IngredientDeleteResult {
  const existing = db
    .select({ id: ingredient.id })
    .from(ingredient)
    .where(eq(ingredient.id, id))
    .get();
  if (!existing) throw new StammdatenError("Zutat nicht gefunden.", 404);

  if (replaceWith != null) {
    if (replaceWith === id) {
      throw new StammdatenError(
        "Ersatz-Zutat darf nicht die zu löschende Zutat sein.",
      );
    }
    const target = db
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.id, replaceWith))
      .get();
    if (!target) {
      throw new StammdatenError("Ersatz-Zutat nicht gefunden.", 404);
    }
    try {
      runMerge(replaceWith, [id], ingredientAdapter);
    } catch (e) {
      if (e instanceof MergeError) {
        throw new StammdatenError(e.message, 409);
      }
      throw e;
    }
    return { deletedId: id, replacedWith: replaceWith };
  }

  const impact = getImpactForIngredients([id]);
  const refs = impact[0]?.refs ?? {};
  if ((refs.recipes ?? 0) > 0 || (refs.shoppingItems ?? 0) > 0) {
    throw new StammdatenError(
      `Zutat wird in ${refs.recipes ?? 0} Rezepten und ${
        refs.shoppingItems ?? 0
      } Einkaufslisten-Einträgen verwendet. Bitte eine Ersatz-Zutat angeben.`,
      409,
    );
  }

  db.delete(ingredient).where(eq(ingredient.id, id)).run();
  return { deletedId: id };
}

export function mergeIngredients(
  winnerId: number,
  loserIds: number[],
): MergeResult<IngredientRow> {
  try {
    return runMerge(winnerId, loserIds, ingredientAdapter);
  } catch (e) {
    if (e instanceof MergeError) throw new StammdatenError(e.message, 409);
    throw e;
  }
}

export function getImpactForIngredients(ids: number[]): ImpactRow[] {
  const base = getImpact(ids, ingredientAdapter);
  const linkedByOwner = linkedRecipesForIngredients(ids);
  return base.map((row) => ({
    ...row,
    linkedRecipes: linkedByOwner.get(row.id) ?? [],
  }));
}

function unreachable(): never {
  throw new Error("unreachable");
}

// Re-export adapter for tests / direct access if needed.
export { ingredientAdapter };
export type { IngredientRow };

// Tx type re-export so route handlers can spell it without reaching into shared
export type { Tx };
