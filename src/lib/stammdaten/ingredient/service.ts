import { asc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "../../../db/index.ts";
import {
  category as categoryTable,
  ingredient,
  ingredientAlias,
  ingredientSubUnit,
  recipeIngredient,
  unit as unitTable,
} from "../../../db/schema.ts";
import { getImpact } from "../shared/impact.ts";
import { linkedRecipesForIngredients } from "../shared/linked-recipes.ts";
import {
  findMergeClusters,
  type ProposalCluster,
} from "../shared/merge-proposals.ts";
import { runMerge, MergeError, type MergeResult } from "../shared/merge.ts";
import type { ImpactRow, Tx } from "../shared/types.ts";
import {
  dedupeAliasesIgnoreCase,
  findNameCollision,
  normalizeName,
  validateName,
} from "../shared/validation.ts";
import { ingredientAdapter, type IngredientRow } from "./adapter.ts";

export type AliasUnitDefault = {
  aliasName: string;
  /** A global unit OR an ingredient sub-unit picked as the alias default.
   *  Exactly one of `unitId` / `subUnitId` is set. */
  unitId: number | null;
  subUnitId: number | null;
  /** Display name of the chosen unit / sub-unit. */
  unitName: string;
};

export type SubUnitItem = {
  id: number;
  name: string;
  perPurchase: number;
};

export type IngredientListItem = {
  id: number;
  name: string;
  aliases: string[];
  /** Optional per-alias default unit. Empty when no alias of this ingredient
   *  carries a default. */
  aliasUnitDefaults: AliasUnitDefault[];
  defaultCategoryId: number | null;
  defaultCategoryName: string | null;
  /** Optional purchase unit (the "Einkaufseinheit") for shopping aggregation.
   *  Null means "no rollup configured" — shopping list aggregates as-is. */
  purchaseUnitId: number | null;
  purchaseUnitName: string | null;
  /** All sub-units defined on this ingredient (Knoblauch → [Zehe]). */
  subUnits: SubUnitItem[];
  excludeFromShoppingList: boolean;
  dietaryClass: "vegan" | "vegetarian" | "meat" | null;
  recipeRefCount: number;
};

export type IngredientDetail = IngredientListItem;

export type IngredientUpsertInput = {
  name: string;
  aliases: string[];
  /** Optional per-alias default unit. Each `aliasName` must appear in
   *  `aliases` for the value to be persisted; entries referencing missing
   *  aliases are silently dropped. Exactly one of `unitId` / `subUnitId`
   *  must be set on each entry; entries with both NULL are dropped. */
  aliasUnitDefaults?: Array<{
    aliasName: string;
    unitId?: number | null;
    /** Index into `subUnits` below (0-based) — resolved to a row id during
     *  save. Lets the client refer to a sub-unit that's being created in
     *  the same upsert. */
    subUnitIndex?: number | null;
  }>;
  /** Sub-units to write (replaces all existing rows for this ingredient).
   *  Order matters: `aliasUnitDefaults.subUnitIndex` indexes into this array. */
  subUnits?: Array<{ name: string; perPurchase: number }>;
  defaultCategoryId: number | null;
  /** Override the ingredient's purchase unit. Null clears it. Undefined
   *  leaves it untouched (only matters on update). */
  purchaseUnitId?: number | null;
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
      purchaseUnitId: ingredient.purchaseUnitId,
      purchaseUnitName: unitTable.name,
      excludeFromShoppingList: ingredient.excludeFromShoppingList,
      dietaryClass: ingredient.dietaryClass,
    })
    .from(ingredient)
    .leftJoin(categoryTable, eq(categoryTable.id, ingredient.defaultCategoryId))
    .leftJoin(unitTable, eq(unitTable.id, ingredient.purchaseUnitId));

  if (!query || query.trim().length === 0) {
    // Case- and diacritic-insensitive order so "Apfel" / "äpfel" /
    // "zucchini" / "Zwiebel" sort together by their visible alphabetical
    // form instead of by binary code point (where all-uppercase letters
    // would land before all-lowercase ones).
    return base.orderBy(sql`unaccent(${ingredient.name})`).all();
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
    .orderBy(sql`unaccent(${ingredient.name})`)
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

function loadAliasUnitDefaults(
  ids: number[],
): Map<number, AliasUnitDefault[]> {
  const out = new Map<number, AliasUnitDefault[]>();
  if (ids.length === 0) return out;
  // Two queries (one for global-unit defaults, one for sub-unit defaults)
  // are cleaner than a single 4-way join with CASE expressions, and the
  // per-row cost is tiny.
  const unitRows = db
    .select({
      ingredientId: ingredientAlias.ingredientId,
      aliasName: ingredientAlias.name,
      unitId: ingredientAlias.defaultUnitId,
      unitName: unitTable.name,
    })
    .from(ingredientAlias)
    .innerJoin(unitTable, eq(unitTable.id, ingredientAlias.defaultUnitId))
    .where(inArray(ingredientAlias.ingredientId, ids))
    .all();
  for (const row of unitRows) {
    if (row.unitId == null || row.unitName == null) continue;
    const list = out.get(row.ingredientId) ?? [];
    list.push({
      aliasName: row.aliasName,
      unitId: row.unitId,
      subUnitId: null,
      unitName: row.unitName,
    });
    out.set(row.ingredientId, list);
  }
  const subUnitRows = db
    .select({
      ingredientId: ingredientAlias.ingredientId,
      aliasName: ingredientAlias.name,
      subUnitId: ingredientAlias.defaultSubUnitId,
      subUnitName: ingredientSubUnit.name,
    })
    .from(ingredientAlias)
    .innerJoin(
      ingredientSubUnit,
      eq(ingredientSubUnit.id, ingredientAlias.defaultSubUnitId),
    )
    .where(inArray(ingredientAlias.ingredientId, ids))
    .all();
  for (const row of subUnitRows) {
    if (row.subUnitId == null || row.subUnitName == null) continue;
    const list = out.get(row.ingredientId) ?? [];
    list.push({
      aliasName: row.aliasName,
      unitId: null,
      subUnitId: row.subUnitId,
      unitName: row.subUnitName,
    });
    out.set(row.ingredientId, list);
  }
  return out;
}

function loadSubUnits(ids: number[]): Map<number, SubUnitItem[]> {
  const out = new Map<number, SubUnitItem[]>();
  if (ids.length === 0) return out;
  const rows = db
    .select({
      id: ingredientSubUnit.id,
      ingredientId: ingredientSubUnit.ingredientId,
      name: ingredientSubUnit.name,
      perPurchase: ingredientSubUnit.perPurchase,
    })
    .from(ingredientSubUnit)
    .where(inArray(ingredientSubUnit.ingredientId, ids))
    .orderBy(asc(ingredientSubUnit.name))
    .all();
  for (const row of rows) {
    const list = out.get(row.ingredientId) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      perPurchase: row.perPurchase,
    });
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
  const aliasUnitDefaults = loadAliasUnitDefaults(ids);
  const subUnits = loadSubUnits(ids);
  const recipeCounts = loadRecipeRefCounts(ids);
  return baseRows.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: aliases.get(row.id) ?? [],
    aliasUnitDefaults: aliasUnitDefaults.get(row.id) ?? [],
    subUnits: subUnits.get(row.id) ?? [],
    defaultCategoryId: row.defaultCategoryId,
    defaultCategoryName: row.defaultCategoryName,
    purchaseUnitId: row.purchaseUnitId,
    purchaseUnitName: row.purchaseUnitName,
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
      purchaseUnitId: ingredient.purchaseUnitId,
      purchaseUnitName: unitTable.name,
      excludeFromShoppingList: ingredient.excludeFromShoppingList,
      dietaryClass: ingredient.dietaryClass,
    })
    .from(ingredient)
    .leftJoin(categoryTable, eq(categoryTable.id, ingredient.defaultCategoryId))
    .leftJoin(unitTable, eq(unitTable.id, ingredient.purchaseUnitId))
    .where(inArray(ingredient.id, ids))
    .all();
  const aliases = loadAliasesGrouped(ids);
  const aliasUnitDefaults = loadAliasUnitDefaults(ids);
  const subUnits = loadSubUnits(ids);
  const recipeCounts = loadRecipeRefCounts(ids);
  return baseRows.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: aliases.get(row.id) ?? [],
    aliasUnitDefaults: aliasUnitDefaults.get(row.id) ?? [],
    subUnits: subUnits.get(row.id) ?? [],
    defaultCategoryId: row.defaultCategoryId,
    defaultCategoryName: row.defaultCategoryName,
    purchaseUnitId: row.purchaseUnitId,
    purchaseUnitName: row.purchaseUnitName,
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
        purchaseUnitId: input.purchaseUnitId ?? null,
        excludeFromShoppingList: input.excludeFromShoppingList,
        dietaryClass: input.dietaryClass,
      })
      .returning({ id: ingredient.id })
      .all();
    const newId = inserted[0].id;
    const subUnitIds = writeSubUnits(tx, newId, input.subUnits ?? []);
    if (aliases.length > 0) {
      const defaultsByAlias = mapAliasDefaults(
        input.aliasUnitDefaults,
        aliases,
        subUnitIds,
      );
      tx.insert(ingredientAlias)
        .values(
          aliases.map((aliasName) => {
            const def = defaultsByAlias.get(aliasName.toLowerCase());
            return {
              ingredientId: newId,
              name: aliasName,
              defaultUnitId: def?.unitId ?? null,
              defaultSubUnitId: def?.subUnitId ?? null,
            };
          }),
        )
        .run();
    }
    return newId;
  });
  return getIngredientDetail(detail) ?? unreachable();
}

/**
 * Replace the ingredient's sub-unit rows with the supplied list. Returns the
 * new row ids in input order, so the alias-defaults writer can resolve
 * `subUnitIndex` references that were collected before the rows existed.
 */
function writeSubUnits(
  tx: Tx,
  ingredientId: number,
  subUnits: Array<{ name: string; perPurchase: number }>,
): number[] {
  tx.delete(ingredientSubUnit)
    .where(eq(ingredientSubUnit.ingredientId, ingredientId))
    .run();
  if (subUnits.length === 0) return [];
  const seen = new Set<string>();
  const out: number[] = [];
  for (const su of subUnits) {
    const name = su.name.trim();
    const key = name.toLowerCase();
    if (name.length === 0 || seen.has(key)) {
      out.push(-1);
      continue;
    }
    seen.add(key);
    const perPurchase =
      Number.isFinite(su.perPurchase) && su.perPurchase > 0
        ? su.perPurchase
        : 1;
    const inserted = tx
      .insert(ingredientSubUnit)
      .values({ ingredientId, name, perPurchase })
      .returning({ id: ingredientSubUnit.id })
      .all();
    out.push(inserted[0].id);
  }
  return out;
}

type ResolvedAliasDefault = {
  unitId: number | null;
  subUnitId: number | null;
};

/**
 * Build a lookup of `aliasNameLower → { unitId, subUnitId }` from the upsert
 * input. Keeps only entries whose `aliasName` survived the alias dedupe
 * pass; resolves `subUnitIndex` against `subUnitIds` (positions returned by
 * `writeSubUnits`). Entries whose sub-unit-index points at a slot that
 * couldn't be written (duplicate / empty name) are dropped.
 */
function mapAliasDefaults(
  defaults: IngredientUpsertInput["aliasUnitDefaults"],
  aliases: string[],
  subUnitIds: number[],
): Map<string, ResolvedAliasDefault> {
  const out = new Map<string, ResolvedAliasDefault>();
  if (!defaults) return out;
  const aliasLower = new Set(aliases.map((a) => a.toLowerCase()));
  for (const d of defaults) {
    const key = d.aliasName.trim().toLowerCase();
    if (!aliasLower.has(key)) continue;
    if (d.subUnitIndex != null) {
      const subId = subUnitIds[d.subUnitIndex];
      if (subId != null && subId > 0) {
        out.set(key, { unitId: null, subUnitId: subId });
        continue;
      }
    }
    if (d.unitId != null) {
      out.set(key, { unitId: d.unitId, subUnitId: null });
    }
  }
  return out;
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
        purchaseUnitId: input.purchaseUnitId ?? null,
        excludeFromShoppingList: input.excludeFromShoppingList,
        dietaryClass: input.dietaryClass,
        updatedAt: nowSec(),
      })
      .where(eq(ingredient.id, id))
      .run();
    tx.delete(ingredientAlias)
      .where(eq(ingredientAlias.ingredientId, id))
      .run();
    const subUnitIds = writeSubUnits(tx, id, input.subUnits ?? []);
    if (aliases.length > 0) {
      const defaultsByAlias = mapAliasDefaults(
        input.aliasUnitDefaults,
        aliases,
        subUnitIds,
      );
      tx.insert(ingredientAlias)
        .values(
          aliases.map((aliasName) => {
            const def = defaultsByAlias.get(aliasName.toLowerCase());
            return {
              ingredientId: id,
              name: aliasName,
              defaultUnitId: def?.unitId ?? null,
              defaultSubUnitId: def?.subUnitId ?? null,
            };
          }),
        )
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
  options?: { replaceIds?: number[] },
): MergeResult<IngredientRow> {
  try {
    return runMerge(winnerId, loserIds, ingredientAdapter, options);
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

export type IngredientBulkPatch = {
  /** Undefined = leave alone, null = clear category, number = set. */
  defaultCategoryId?: number | null;
  /** Undefined = leave alone, null = clear, "vegan"/"vegetarian"/"meat" = set. */
  dietaryClass?: "vegan" | "vegetarian" | "meat" | null;
  excludeFromShoppingList?: boolean;
};

export type IngredientBulkResult = {
  updatedIds: number[];
};

/**
 * Apply a partial patch to every selected ingredient. Each field is tristate:
 *   - omitted (`undefined`) → not touched
 *   - explicit `null` (categoryId / dietaryClass) → cleared
 *   - value → set to the value
 * No-op if `patch` carries no fields.
 */
export function bulkUpdateIngredients(
  ids: number[],
  patch: IngredientBulkPatch,
): IngredientBulkResult {
  if (ids.length === 0) return { updatedIds: [] };
  const setObj: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(patch, "defaultCategoryId")) {
    setObj.defaultCategoryId = patch.defaultCategoryId ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "dietaryClass")) {
    setObj.dietaryClass = patch.dietaryClass ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "excludeFromShoppingList")) {
    setObj.excludeFromShoppingList = patch.excludeFromShoppingList;
  }
  if (Object.keys(setObj).length === 0) return { updatedIds: [] };
  setObj.updatedAt = nowSec();

  // Verify the category exists when caller wanted to set one (clearing is
  // always safe). FK violation would otherwise surface as a generic 500.
  if (
    patch.defaultCategoryId != null &&
    typeof patch.defaultCategoryId === "number"
  ) {
    const exists = db
      .select({ id: categoryTable.id })
      .from(categoryTable)
      .where(eq(categoryTable.id, patch.defaultCategoryId))
      .get();
    if (!exists) {
      throw new StammdatenError("Kategorie nicht gefunden.", 404);
    }
  }

  db.update(ingredient).set(setObj).where(inArray(ingredient.id, ids)).run();
  return { updatedIds: ids };
}

export function getMergeProposalsForIngredients(): ProposalCluster[] {
  const list = listIngredients();
  return findMergeClusters(
    list.map((item) => ({
      id: item.id,
      name: item.name,
      aliases: item.aliases,
      refCount: item.recipeRefCount,
    })),
  );
}

function unreachable(): never {
  throw new Error("unreachable");
}

// Re-export adapter for tests / direct access if needed.
export { ingredientAdapter };
export type { IngredientRow };

// Tx type re-export so route handlers can spell it without reaching into shared
export type { Tx };
