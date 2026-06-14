import { asc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "../../../db/index.ts";
import {
  quantifier,
  quantifierAlias,
  recipeIngredient,
} from "../../../db/schema.ts";
import { getImpact } from "../shared/impact.ts";
import { linkedRecipesForQuantifiers } from "../shared/linked-recipes.ts";
import { runMerge, MergeError, type MergeResult } from "../shared/merge.ts";
import type { ImpactRow } from "../shared/types.ts";
import {
  dedupeAliasesIgnoreCase,
  findNameCollision,
  normalizeName,
  validateName,
} from "../shared/validation.ts";
import { quantifierAdapter, type QuantifierRow } from "./adapter.ts";

export type QuantifierListItem = {
  id: number;
  name: string;
  /** Numeric value; null = unspecified ("einige"). */
  value: number | null;
  aliases: string[];
  sortOrder: number;
  recipeRefCount: number;
};

export type QuantifierUpsertInput = {
  name: string;
  value: number | null;
  aliases: string[];
  sortOrder?: number;
};

export class QuantifierStammdatenError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "QuantifierStammdatenError";
    this.status = status;
  }
}

function loadAliasesGrouped(ids: number[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  if (ids.length === 0) return out;
  const rows = db
    .select({ quantifierId: quantifierAlias.quantifierId, name: quantifierAlias.name })
    .from(quantifierAlias)
    .where(inArray(quantifierAlias.quantifierId, ids))
    .orderBy(asc(quantifierAlias.name))
    .all();
  for (const row of rows) {
    const list = out.get(row.quantifierId) ?? [];
    list.push(row.name);
    out.set(row.quantifierId, list);
  }
  return out;
}

function loadRecipeRefCounts(ids: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const rows = db
    .select({
      id: recipeIngredient.quantifierId,
      count: sql<number>`count(*)`,
    })
    .from(recipeIngredient)
    .where(inArray(recipeIngredient.quantifierId, ids))
    .groupBy(recipeIngredient.quantifierId)
    .all();
  for (const row of rows) {
    if (row.id != null) out.set(row.id, Number(row.count));
  }
  return out;
}

function loadQuantifiersBase(query?: string) {
  if (!query || query.trim().length === 0) {
    return db
      .select({
        id: quantifier.id,
        name: quantifier.name,
        value: quantifier.value,
        sortOrder: quantifier.sortOrder,
      })
      .from(quantifier)
      .orderBy(sql`unaccent(${quantifier.name})`)
      .all();
  }
  const pattern = `%${query.trim().toLowerCase().replace(/[%_]/g, "\\$&")}%`;
  const aliasMatchIds = db
    .select({ id: quantifierAlias.quantifierId })
    .from(quantifierAlias)
    .where(sql`lower_u(${quantifierAlias.name}) LIKE ${pattern}`);
  return db
    .select({
      id: quantifier.id,
      name: quantifier.name,
      value: quantifier.value,
      sortOrder: quantifier.sortOrder,
    })
    .from(quantifier)
    .where(
      or(
        sql`lower_u(${quantifier.name}) LIKE ${pattern}`,
        inArray(quantifier.id, aliasMatchIds),
      ),
    )
    .orderBy(sql`unaccent(${quantifier.name})`)
    .all();
}

export function listQuantifiersManaged(query?: string): QuantifierListItem[] {
  const base = loadQuantifiersBase(query);
  const ids = base.map((r) => r.id);
  const aliases = loadAliasesGrouped(ids);
  const recipeCounts = loadRecipeRefCounts(ids);
  return base.map((row) => ({
    id: row.id,
    name: row.name,
    value: row.value ?? null,
    aliases: aliases.get(row.id) ?? [],
    sortOrder: row.sortOrder,
    recipeRefCount: recipeCounts.get(row.id) ?? 0,
  }));
}

export function getQuantifierDetail(id: number): QuantifierListItem | null {
  const row = db
    .select({
      id: quantifier.id,
      name: quantifier.name,
      value: quantifier.value,
      sortOrder: quantifier.sortOrder,
    })
    .from(quantifier)
    .where(eq(quantifier.id, id))
    .get();
  if (!row) return null;
  const aliases = loadAliasesGrouped([id]);
  const recipeCounts = loadRecipeRefCounts([id]);
  return {
    id: row.id,
    name: row.name,
    value: row.value ?? null,
    aliases: aliases.get(row.id) ?? [],
    sortOrder: row.sortOrder,
    recipeRefCount: recipeCounts.get(row.id) ?? 0,
  };
}

function validateInput(
  input: QuantifierUpsertInput,
  excludeId?: number,
): { name: string; value: number | null; aliases: string[] } {
  const nameError = validateName(input.name);
  if (nameError) throw new QuantifierStammdatenError(nameError);
  const cleanedName = normalizeName(input.name);

  if (input.value != null && !Number.isFinite(input.value)) {
    throw new QuantifierStammdatenError("Wert muss eine Zahl sein.");
  }

  const aliasResult = dedupeAliasesIgnoreCase(input.aliases, cleanedName);
  if (aliasResult.error) throw new QuantifierStammdatenError(aliasResult.error);
  const cleanedAliases = aliasResult.aliases;

  const nameCollision = findNameCollision({
    name: cleanedName,
    canonicalTable: quantifier,
    canonicalIdColumn: quantifier.id,
    canonicalNameColumn: quantifier.name,
    aliasTable: quantifierAlias,
    aliasParentColumn: quantifierAlias.quantifierId,
    aliasNameColumn: quantifierAlias.name,
    excludeCanonicalId: excludeId,
    excludeAliasParentId: excludeId,
  });
  if (nameCollision) {
    throw new QuantifierStammdatenError(
      `Der Name "${cleanedName}" ist bereits vergeben (${
        nameCollision.kind === "canonical" ? "als Mengenangabe" : "als Alias"
      }: "${nameCollision.name}").`,
      409,
    );
  }

  for (const alias of cleanedAliases) {
    const collision = findNameCollision({
      name: alias,
      canonicalTable: quantifier,
      canonicalIdColumn: quantifier.id,
      canonicalNameColumn: quantifier.name,
      aliasTable: quantifierAlias,
      aliasParentColumn: quantifierAlias.quantifierId,
      aliasNameColumn: quantifierAlias.name,
      excludeCanonicalId: excludeId,
      excludeAliasParentId: excludeId,
    });
    if (collision) {
      throw new QuantifierStammdatenError(
        `Alias "${alias}" ist bereits vergeben (${
          collision.kind === "canonical" ? "als Mengenangabe" : "als Alias"
        }: "${collision.name}").`,
        409,
      );
    }
  }

  return { name: cleanedName, value: input.value ?? null, aliases: cleanedAliases };
}

export function createQuantifier(
  input: QuantifierUpsertInput,
): QuantifierListItem {
  const { name, value, aliases } = validateInput(input);
  const id = db.transaction((tx) => {
    const inserted = tx
      .insert(quantifier)
      .values({
        name,
        value,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning({ id: quantifier.id })
      .all();
    const newId = inserted[0].id;
    if (aliases.length > 0) {
      tx.insert(quantifierAlias)
        .values(aliases.map((aliasName) => ({ quantifierId: newId, name: aliasName })))
        .run();
    }
    return newId;
  });
  return getQuantifierDetail(id) ?? unreachable();
}

export function updateQuantifier(
  id: number,
  input: QuantifierUpsertInput,
): QuantifierListItem {
  const existing = db
    .select({ id: quantifier.id, sortOrder: quantifier.sortOrder })
    .from(quantifier)
    .where(eq(quantifier.id, id))
    .get();
  if (!existing) {
    throw new QuantifierStammdatenError("Mengenangabe nicht gefunden.", 404);
  }

  const { name, value, aliases } = validateInput(input, id);

  db.transaction((tx) => {
    tx.update(quantifier)
      .set({
        name,
        value,
        sortOrder: input.sortOrder ?? existing.sortOrder,
      })
      .where(eq(quantifier.id, id))
      .run();
    tx.delete(quantifierAlias).where(eq(quantifierAlias.quantifierId, id)).run();
    if (aliases.length > 0) {
      tx.insert(quantifierAlias)
        .values(aliases.map((aliasName) => ({ quantifierId: id, name: aliasName })))
        .run();
    }
  });
  return getQuantifierDetail(id) ?? unreachable();
}

export type QuantifierDeleteResult = {
  deletedId: number;
  replacedWith?: number;
};

export function deleteQuantifier(
  id: number,
  replaceWith?: number,
): QuantifierDeleteResult {
  const existing = db
    .select({ id: quantifier.id })
    .from(quantifier)
    .where(eq(quantifier.id, id))
    .get();
  if (!existing) {
    throw new QuantifierStammdatenError("Mengenangabe nicht gefunden.", 404);
  }

  if (replaceWith != null) {
    if (replaceWith === id) {
      throw new QuantifierStammdatenError(
        "Ersatz-Mengenangabe darf nicht die zu löschende Mengenangabe sein.",
      );
    }
    const target = db
      .select({ id: quantifier.id })
      .from(quantifier)
      .where(eq(quantifier.id, replaceWith))
      .get();
    if (!target) {
      throw new QuantifierStammdatenError(
        "Ersatz-Mengenangabe nicht gefunden.",
        404,
      );
    }
    try {
      runMerge(replaceWith, [id], quantifierAdapter);
    } catch (e) {
      if (e instanceof MergeError) {
        throw new QuantifierStammdatenError(e.message, 409);
      }
      throw e;
    }
    return { deletedId: id, replacedWith: replaceWith };
  }

  // Unlike units (SET NULL), recipe_ingredient.quantifier_id is RESTRICT, so a
  // referenced quantifier can't just be dropped. Refuse with a clear message
  // and steer the caller to pass a replacement.
  const refCount = loadRecipeRefCounts([id]).get(id) ?? 0;
  if (refCount > 0) {
    throw new QuantifierStammdatenError(
      `Die Mengenangabe wird in ${refCount} Rezept${
        refCount === 1 ? "" : "en"
      } verwendet und kann nicht gelöscht werden. Bitte eine Ersatz-Mengenangabe angeben.`,
      409,
    );
  }

  db.delete(quantifier).where(eq(quantifier.id, id)).run();
  return { deletedId: id };
}

export function mergeQuantifiers(
  winnerId: number,
  loserIds: number[],
  options?: { replaceIds?: number[] },
): MergeResult<QuantifierRow> {
  try {
    return runMerge(winnerId, loserIds, quantifierAdapter, options);
  } catch (e) {
    if (e instanceof MergeError) {
      throw new QuantifierStammdatenError(e.message, 409);
    }
    throw e;
  }
}

export function getImpactForQuantifiers(ids: number[]): ImpactRow[] {
  const base = getImpact(ids, quantifierAdapter);
  const linkedByOwner = linkedRecipesForQuantifiers(ids);
  return base.map((row) => ({
    ...row,
    linkedRecipes: linkedByOwner.get(row.id) ?? [],
  }));
}

function unreachable(): never {
  throw new Error("unreachable");
}
