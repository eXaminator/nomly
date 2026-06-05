import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "../../../db/index.ts";
import {
  category as categoryTable,
  ingredient,
  ingredientAlias,
  ingredientSupermarketUnavailable,
  ingredientUnitConversion,
  recipeIngredient,
  supermarket as supermarketTable,
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
  /** Global default unit for this alias. Promoted former sub-units are global
   *  units now, so e.g. "Knoblauchzehe" can default to the "Zehe" unit here. */
  unitId: number;
  /** Display name of the chosen unit. */
  unitName: string;
};

/**
 * One per-ingredient conversion edge (`1 from = factor × to`). Container edges
 * (`is_container = true`) are the "buy whole packs" rule; non-container edges
 * are normalization (density, count breakdown). Mirrors a row of
 * `ingredient_unit_conversion`. See src/lib/units/convert.ts.
 */
export type ConversionItem = {
  id: number;
  fromUnitId: number;
  fromUnitName: string;
  toUnitId: number;
  toUnitName: string;
  factor: number;
  isContainer: boolean;
};

export type IngredientListItem = {
  id: number;
  name: string;
  aliases: string[];
  /** Optional per-alias default unit. Empty when no alias of this ingredient
   *  carries a default. */
  aliasUnitDefaults: AliasUnitDefault[];
  /** Optional per-alias display rename, keyed by alias name. When a recipe line
   *  matches the alias, the row shows this name instead of the alias text
   *  ("Knoblauchzehe" → "Knoblauch"). Only aliases with a rename appear here. */
  aliasDisplayNames: Record<string, string>;
  defaultCategoryId: number | null;
  defaultCategoryName: string | null;
  /** Per-ingredient unit conversions (density + container edges). */
  conversions: ConversionItem[];
  /** Canonical-name parser default unit. */
  defaultUnitId: number | null;
  defaultUnitName: string | null;
  excludeFromShoppingList: boolean;
  isEquipment: boolean;
  dietaryClass: "vegan" | "vegetarian" | "meat" | null;
  /** Supermarkets this article is not carried at (`ingredient_supermarket_
   *  unavailable`). The shopping list mutes these in the active store's view. */
  excludedSupermarkets: Array<{ id: number; name: string }>;
  recipeRefCount: number;
};

export type IngredientDetail = IngredientListItem;

export type IngredientUpsertInput = {
  name: string;
  aliases: string[];
  /** Optional per-alias default unit. Each `aliasName` must appear in
   *  `aliases` for the value to be persisted; entries referencing missing
   *  aliases (or with a null `unitId`) are silently dropped. */
  aliasUnitDefaults?: Array<{
    aliasName: string;
    unitId?: number | null;
    /** Display spelling for the default unit (a unit alias like "clove"). */
    unitDisplay?: string | null;
  }>;
  /** Optional per-alias display rename, keyed by alias name. Entries
   *  referencing a missing alias (or with an empty value) are dropped. */
  aliasDisplayNames?: Record<string, string>;
  /** Per-ingredient conversions to write (replaces all existing rows for this
   *  ingredient). `1 fromUnitId = factor × toUnitId`. */
  conversions?: Array<{
    fromUnitId: number;
    toUnitId: number;
    factor: number;
    isContainer?: boolean;
  }>;
  /** Canonical-name parser default unit. Null/omitted clears it. */
  defaultUnitId?: number | null;
  /** Display spelling for the canonical-name default unit (a unit alias). */
  defaultUnitDisplay?: string | null;
  defaultCategoryId: number | null;
  excludeFromShoppingList: boolean;
  isEquipment?: boolean;
  dietaryClass: "vegan" | "vegetarian" | "meat" | null;
  /** Supermarkets this article should be marked unavailable at. Replaces the
   *  full set of `ingredient_supermarket_unavailable` rows for this ingredient.
   *  Omitted = leave unchanged on update / none on create. */
  excludedSupermarketIds?: number[];
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
      defaultUnitId: ingredient.defaultUnitId,
      defaultUnitDisplay: ingredient.defaultUnitDisplay,
      excludeFromShoppingList: ingredient.excludeFromShoppingList,
      isEquipment: ingredient.isEquipment,
      dietaryClass: ingredient.dietaryClass,
    })
    .from(ingredient)
    .leftJoin(categoryTable, eq(categoryTable.id, ingredient.defaultCategoryId));

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
  const unitRows = db
    .select({
      ingredientId: ingredientAlias.ingredientId,
      aliasName: ingredientAlias.name,
      unitId: ingredientAlias.defaultUnitId,
      unitName: unitTable.name,
      unitDisplay: ingredientAlias.defaultUnitDisplay,
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
      // Show the chosen spelling (a unit alias like "clove") when set.
      unitName: row.unitDisplay ?? row.unitName,
    });
    out.set(row.ingredientId, list);
  }
  return out;
}

/** Per-ingredient alias display renames, as `{ aliasName: displayName }` maps
 *  keyed by ingredient id. Only aliases with a non-empty rename are included. */
function loadAliasDisplayNames(
  ids: number[],
): Map<number, Record<string, string>> {
  const out = new Map<number, Record<string, string>>();
  if (ids.length === 0) return out;
  const rows = db
    .select({
      ingredientId: ingredientAlias.ingredientId,
      aliasName: ingredientAlias.name,
      displayName: ingredientAlias.displayName,
    })
    .from(ingredientAlias)
    .where(inArray(ingredientAlias.ingredientId, ids))
    .all();
  for (const row of rows) {
    if (!row.displayName) continue;
    const map = out.get(row.ingredientId) ?? {};
    map[row.aliasName] = row.displayName;
    out.set(row.ingredientId, map);
  }
  return out;
}

/** Per-ingredient conversion rows, joined to both unit names, grouped by id. */
function loadConversions(ids: number[]): Map<number, ConversionItem[]> {
  const out = new Map<number, ConversionItem[]>();
  if (ids.length === 0) return out;
  const fromUnit = alias(unitTable, "from_unit");
  const toUnit = alias(unitTable, "to_unit");
  const rows = db
    .select({
      id: ingredientUnitConversion.id,
      ingredientId: ingredientUnitConversion.ingredientId,
      fromUnitId: ingredientUnitConversion.fromUnitId,
      fromUnitName: fromUnit.name,
      toUnitId: ingredientUnitConversion.toUnitId,
      toUnitName: toUnit.name,
      factor: ingredientUnitConversion.factor,
      isContainer: ingredientUnitConversion.isContainer,
    })
    .from(ingredientUnitConversion)
    .innerJoin(fromUnit, eq(fromUnit.id, ingredientUnitConversion.fromUnitId))
    .innerJoin(toUnit, eq(toUnit.id, ingredientUnitConversion.toUnitId))
    .where(inArray(ingredientUnitConversion.ingredientId, ids))
    .orderBy(asc(ingredientUnitConversion.id))
    .all();
  for (const row of rows) {
    const list = out.get(row.ingredientId) ?? [];
    list.push({
      id: row.id,
      fromUnitId: row.fromUnitId,
      fromUnitName: row.fromUnitName,
      toUnitId: row.toUnitId,
      toUnitName: row.toUnitName,
      factor: row.factor,
      isContainer: row.isContainer,
    });
    out.set(row.ingredientId, list);
  }
  return out;
}

/** Per-ingredient excluded supermarkets, joined to the supermarket name. */
function loadExcludedSupermarkets(
  ids: number[],
): Map<number, Array<{ id: number; name: string }>> {
  const out = new Map<number, Array<{ id: number; name: string }>>();
  if (ids.length === 0) return out;
  const rows = db
    .select({
      ingredientId: ingredientSupermarketUnavailable.ingredientId,
      id: supermarketTable.id,
      name: supermarketTable.name,
    })
    .from(ingredientSupermarketUnavailable)
    .innerJoin(
      supermarketTable,
      eq(supermarketTable.id, ingredientSupermarketUnavailable.supermarketId),
    )
    .where(inArray(ingredientSupermarketUnavailable.ingredientId, ids))
    .orderBy(sql`unaccent(${supermarketTable.name})`)
    .all();
  for (const row of rows) {
    const list = out.get(row.ingredientId) ?? [];
    list.push({ id: row.id, name: row.name });
    out.set(row.ingredientId, list);
  }
  return out;
}

/** unitId → name, for resolving canonical-name default unit display names. */
function loadUnitNames(unitIds: number[]): Map<number, string> {
  const out = new Map<number, string>();
  const ids = Array.from(new Set(unitIds.filter((id): id is number => id != null)));
  if (ids.length === 0) return out;
  const rows = db
    .select({ id: unitTable.id, name: unitTable.name })
    .from(unitTable)
    .where(inArray(unitTable.id, ids))
    .all();
  for (const row of rows) out.set(row.id, row.name);
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
  // The inArray filter excludes unassigned (NULL ingredient_id) rows; the
  // guard also narrows the type for the Map<number, number> below.
  for (const row of rows) {
    if (row.id == null) continue;
    out.set(row.id, Number(row.count));
  }
  return out;
}

export function listIngredients(query?: string): IngredientListItem[] {
  const baseRows = selectIngredientWithJoinedData(query);
  const ids = baseRows.map((r) => r.id);
  const aliases = loadAliasesGrouped(ids);
  const aliasUnitDefaults = loadAliasUnitDefaults(ids);
  const aliasDisplayNames = loadAliasDisplayNames(ids);
  const conversions = loadConversions(ids);
  const excludedSupermarkets = loadExcludedSupermarkets(ids);
  const unitNames = loadUnitNames(baseRows.map((r) => r.defaultUnitId ?? -1));
  const recipeCounts = loadRecipeRefCounts(ids);
  return baseRows.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: aliases.get(row.id) ?? [],
    aliasUnitDefaults: aliasUnitDefaults.get(row.id) ?? [],
    aliasDisplayNames: aliasDisplayNames.get(row.id) ?? {},
    conversions: conversions.get(row.id) ?? [],
    defaultUnitId: row.defaultUnitId,
    defaultUnitName:
      row.defaultUnitDisplay ??
      (row.defaultUnitId != null ? unitNames.get(row.defaultUnitId) ?? null : null),
    defaultCategoryId: row.defaultCategoryId,
    defaultCategoryName: row.defaultCategoryName,
    excludeFromShoppingList: row.excludeFromShoppingList,
    isEquipment: row.isEquipment,
    dietaryClass: row.dietaryClass,
    excludedSupermarkets: excludedSupermarkets.get(row.id) ?? [],
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
      defaultUnitId: ingredient.defaultUnitId,
      defaultUnitDisplay: ingredient.defaultUnitDisplay,
      excludeFromShoppingList: ingredient.excludeFromShoppingList,
      isEquipment: ingredient.isEquipment,
      dietaryClass: ingredient.dietaryClass,
    })
    .from(ingredient)
    .leftJoin(categoryTable, eq(categoryTable.id, ingredient.defaultCategoryId))
    .where(inArray(ingredient.id, ids))
    .all();
  const aliases = loadAliasesGrouped(ids);
  const aliasUnitDefaults = loadAliasUnitDefaults(ids);
  const aliasDisplayNames = loadAliasDisplayNames(ids);
  const conversions = loadConversions(ids);
  const excludedSupermarkets = loadExcludedSupermarkets(ids);
  const unitNames = loadUnitNames(baseRows.map((r) => r.defaultUnitId ?? -1));
  const recipeCounts = loadRecipeRefCounts(ids);
  return baseRows.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: aliases.get(row.id) ?? [],
    aliasUnitDefaults: aliasUnitDefaults.get(row.id) ?? [],
    aliasDisplayNames: aliasDisplayNames.get(row.id) ?? {},
    conversions: conversions.get(row.id) ?? [],
    defaultUnitId: row.defaultUnitId,
    defaultUnitName:
      row.defaultUnitDisplay ??
      (row.defaultUnitId != null ? unitNames.get(row.defaultUnitId) ?? null : null),
    defaultCategoryId: row.defaultCategoryId,
    defaultCategoryName: row.defaultCategoryName,
    excludeFromShoppingList: row.excludeFromShoppingList,
    isEquipment: row.isEquipment,
    dietaryClass: row.dietaryClass,
    excludedSupermarkets: excludedSupermarkets.get(row.id) ?? [],
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

  // Only canonical-vs-canonical collisions are blocked (also enforced by the
  // unique index on ingredient.name). Every cross-namespace overlap — an alias
  // shadowing another ingredient's canonical name or vice versa, and shared
  // aliases — is allowed: the line's unit decides at match time, and the
  // management UI surfaces overlaps as an advisory note instead of erroring.
  const nameCollision = findNameCollision({
    name: cleanedName,
    canonicalTable: ingredient,
    canonicalIdColumn: ingredient.id,
    canonicalNameColumn: ingredient.name,
    aliasTable: null,
    aliasParentColumn: null,
    aliasNameColumn: null,
    excludeCanonicalId: excludeId,
  });
  if (nameCollision) {
    throw new StammdatenError(
      `Der Name "${cleanedName}" ist bereits vergeben (als Zutat: "${nameCollision.name}").`,
      409,
    );
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
        defaultUnitId: input.defaultUnitId ?? null,
        defaultUnitDisplay: input.defaultUnitDisplay?.trim() || null,
        excludeFromShoppingList: input.excludeFromShoppingList,
        isEquipment: input.isEquipment ?? false,
        dietaryClass: input.dietaryClass,
      })
      .returning({ id: ingredient.id })
      .all();
    const newId = inserted[0].id;
    writeConversions(tx, newId, input.conversions ?? []);
    writeExcludedSupermarkets(tx, newId, input.excludedSupermarketIds ?? []);
    if (aliases.length > 0) {
      const defaultsByAlias = mapAliasDefaults(input.aliasUnitDefaults, aliases);
      const displayByAlias = mapAliasDisplayNames(input.aliasDisplayNames, aliases);
      tx.insert(ingredientAlias)
        .values(
          aliases.map((aliasName) => {
            const def = defaultsByAlias.get(aliasName.toLowerCase());
            return {
              ingredientId: newId,
              name: aliasName,
              defaultUnitId: def?.unitId ?? null,
              defaultUnitDisplay: def?.display ?? null,
              displayName: displayByAlias.get(aliasName.toLowerCase()) ?? null,
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
 * Replace the ingredient's conversion rows with the supplied list. Drops rows
 * whose units coincide or whose factor isn't a positive finite number, and
 * de-dupes on `(from, to)` (the table's unique index). Container edges keep
 * `isContainer = true`.
 */
function writeConversions(
  tx: Tx,
  ingredientId: number,
  conversions: Array<{
    fromUnitId: number;
    toUnitId: number;
    factor: number;
    isContainer?: boolean;
  }>,
): void {
  tx.delete(ingredientUnitConversion)
    .where(eq(ingredientUnitConversion.ingredientId, ingredientId))
    .run();
  if (conversions.length === 0) return;
  const seen = new Set<string>();
  const rows = [];
  for (const c of conversions) {
    if (
      c.fromUnitId === c.toUnitId ||
      !Number.isFinite(c.factor) ||
      c.factor <= 0
    ) {
      continue;
    }
    const key = `${c.fromUnitId}->${c.toUnitId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      ingredientId,
      fromUnitId: c.fromUnitId,
      toUnitId: c.toUnitId,
      factor: c.factor,
      isContainer: c.isContainer ?? false,
    });
  }
  if (rows.length > 0) tx.insert(ingredientUnitConversion).values(rows).run();
}

/**
 * Replace the ingredient's excluded-supermarket rows with the supplied set.
 * De-dupes the ids and validates that each supermarket exists (an unknown id
 * would otherwise surface as a raw FK 500). Mirrors {@link writeConversions}:
 * delete-all-then-insert, so the passed list is the new complete set.
 */
function writeExcludedSupermarkets(
  tx: Tx,
  ingredientId: number,
  supermarketIds: number[],
): void {
  tx.delete(ingredientSupermarketUnavailable)
    .where(eq(ingredientSupermarketUnavailable.ingredientId, ingredientId))
    .run();
  const ids = Array.from(new Set(supermarketIds));
  if (ids.length === 0) return;
  const found = tx
    .select({ id: supermarketTable.id })
    .from(supermarketTable)
    .where(inArray(supermarketTable.id, ids))
    .all();
  if (found.length !== ids.length) {
    const have = new Set(found.map((r) => r.id));
    const missing = ids.filter((id) => !have.has(id));
    throw new StammdatenError(
      `Unbekannte Supermärkte: ${missing.join(", ")}.`,
      404,
    );
  }
  tx.insert(ingredientSupermarketUnavailable)
    .values(ids.map((supermarketId) => ({ ingredientId, supermarketId })))
    .run();
}

/**
 * Build a lookup of `aliasNameLower → { unitId, display }` from the upsert
 * input. Keeps only entries whose `aliasName` survived the dedupe pass and
 * carry a unit. `display` is the chosen spelling (a unit alias) or null.
 */
function mapAliasDefaults(
  defaults: IngredientUpsertInput["aliasUnitDefaults"],
  aliases: string[],
): Map<string, { unitId: number; display: string | null }> {
  const out = new Map<string, { unitId: number; display: string | null }>();
  if (!defaults) return out;
  const aliasLower = new Set(aliases.map((a) => a.toLowerCase()));
  for (const d of defaults) {
    const key = d.aliasName.trim().toLowerCase();
    if (!aliasLower.has(key)) continue;
    if (d.unitId != null) {
      out.set(key, { unitId: d.unitId, display: d.unitDisplay?.trim() || null });
    }
  }
  return out;
}

/**
 * Build a lookup of `aliasNameLower → displayName` from the upsert input. Keeps
 * only entries whose `aliasName` survived the dedupe pass and carry a non-empty
 * rename.
 */
function mapAliasDisplayNames(
  displayNames: IngredientUpsertInput["aliasDisplayNames"],
  aliases: string[],
): Map<string, string> {
  const out = new Map<string, string>();
  if (!displayNames) return out;
  const aliasLower = new Set(aliases.map((a) => a.toLowerCase()));
  for (const [aliasName, raw] of Object.entries(displayNames)) {
    const key = aliasName.trim().toLowerCase();
    const value = raw?.trim();
    if (!aliasLower.has(key) || !value) continue;
    out.set(key, value);
  }
  return out;
}

export function updateIngredient(
  id: number,
  input: IngredientUpsertInput,
  /** Optional name renames to propagate: each existing recipe row of THIS
   *  ingredient whose `display_name` exactly equals `from` is rewritten to
   *  `to`. Empty (the default) leaves recipes untouched. */
  propagateRenames: Array<{ from: string; to: string }> = [],
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
        defaultUnitId: input.defaultUnitId ?? null,
        defaultUnitDisplay: input.defaultUnitDisplay?.trim() || null,
        excludeFromShoppingList: input.excludeFromShoppingList,
        isEquipment: input.isEquipment ?? false,
        dietaryClass: input.dietaryClass,
        updatedAt: nowSec(),
      })
      .where(eq(ingredient.id, id))
      .run();
    tx.delete(ingredientAlias)
      .where(eq(ingredientAlias.ingredientId, id))
      .run();
    writeConversions(tx, id, input.conversions ?? []);
    // Only touch exclusions when the caller supplied them — an omitted field
    // leaves the existing rows alone (callers that don't manage exclusions).
    if (input.excludedSupermarketIds !== undefined) {
      writeExcludedSupermarkets(tx, id, input.excludedSupermarketIds);
    }
    if (aliases.length > 0) {
      const defaultsByAlias = mapAliasDefaults(input.aliasUnitDefaults, aliases);
      const displayByAlias = mapAliasDisplayNames(input.aliasDisplayNames, aliases);
      tx.insert(ingredientAlias)
        .values(
          aliases.map((aliasName) => {
            const def = defaultsByAlias.get(aliasName.toLowerCase());
            return {
              ingredientId: id,
              name: aliasName,
              defaultUnitId: def?.unitId ?? null,
              defaultUnitDisplay: def?.display ?? null,
              displayName: displayByAlias.get(aliasName.toLowerCase()) ?? null,
            };
          }),
        )
        .run();
    }
    // Propagate renames into existing recipe rows of this ingredient. Exact
    // display_name match only (case-sensitive), scoped to `ingredient_id` so a
    // coincidental same-text row of another ingredient is never touched.
    for (const { from, to } of propagateRenames) {
      if (from === to) continue;
      tx.update(recipeIngredient)
        .set({ displayName: to })
        .where(
          and(
            eq(recipeIngredient.ingredientId, id),
            eq(recipeIngredient.displayName, from),
          ),
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
  isEquipment?: boolean;
  /** Supermarkets to mark unavailable on every selected article. Additive and
   *  idempotent — never touches exclusions outside this set. */
  addExcludedSupermarketIds?: number[];
  /** Supermarkets to un-exclude (restore availability) on every selected
   *  article. A pair not present is a silent no-op. */
  removeExcludedSupermarketIds?: number[];
};

export type IngredientBulkResult = {
  updatedIds: number[];
};

/**
 * Apply a partial patch to every selected ingredient. Scalar fields are
 * tristate:
 *   - omitted (`undefined`) → not touched
 *   - explicit `null` (categoryId / dietaryClass) → cleared
 *   - value → set to the value
 * Excluded-supermarket edits are set operations (add / remove), applied
 * per-article so each article's other exclusions stay intact. No-op if `patch`
 * carries no fields.
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
  if (Object.prototype.hasOwnProperty.call(patch, "isEquipment")) {
    setObj.isEquipment = patch.isEquipment;
  }
  const hasScalar = Object.keys(setObj).length > 0;
  const addSupermarketIds = Array.from(
    new Set(patch.addExcludedSupermarketIds ?? []),
  );
  const removeSupermarketIds = Array.from(
    new Set(patch.removeExcludedSupermarketIds ?? []),
  );
  if (!hasScalar && addSupermarketIds.length === 0 && removeSupermarketIds.length === 0) {
    return { updatedIds: [] };
  }

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

  // Verify referenced supermarkets exist (add + remove) — a bad id would
  // otherwise surface as a raw FK 500 on insert.
  const allSupermarketIds = Array.from(
    new Set([...addSupermarketIds, ...removeSupermarketIds]),
  );
  if (allSupermarketIds.length > 0) {
    const found = db
      .select({ id: supermarketTable.id })
      .from(supermarketTable)
      .where(inArray(supermarketTable.id, allSupermarketIds))
      .all();
    if (found.length !== allSupermarketIds.length) {
      const have = new Set(found.map((r) => r.id));
      const missing = allSupermarketIds.filter((id) => !have.has(id));
      throw new StammdatenError(
        `Unbekannte Supermärkte: ${missing.join(", ")}.`,
        404,
      );
    }
  }

  db.transaction((tx) => {
    if (hasScalar) {
      tx.update(ingredient)
        .set({ ...setObj, updatedAt: nowSec() })
        .where(inArray(ingredient.id, ids))
        .run();
    }
    if (removeSupermarketIds.length > 0) {
      tx.delete(ingredientSupermarketUnavailable)
        .where(
          and(
            inArray(ingredientSupermarketUnavailable.ingredientId, ids),
            inArray(
              ingredientSupermarketUnavailable.supermarketId,
              removeSupermarketIds,
            ),
          ),
        )
        .run();
    }
    if (addSupermarketIds.length > 0) {
      const rows = ids.flatMap((ingredientId) =>
        addSupermarketIds.map((supermarketId) => ({ ingredientId, supermarketId })),
      );
      tx.insert(ingredientSupermarketUnavailable)
        .values(rows)
        .onConflictDoNothing()
        .run();
    }
  });
  return { updatedIds: ids };
}

export type BulkConversionInput = {
  fromUnitId: number;
  toUnitId: number;
  factor: number;
  isContainer?: boolean;
  /** Articles with no existing `(from→to)` edge → insert. */
  addIds: number[];
  /** Articles that already carry the edge → update factor + isContainer. */
  overwriteIds: number[];
};

export type BulkConversionResult = {
  addedIds: number[];
  overwrittenIds: number[];
  skippedIds: number[];
};

/**
 * Add one conversion edge (`1 from = factor × to`) to many articles at once.
 * Additive — never touches an article's *other* conversions (unlike
 * {@link writeConversions}, which replaces all). Existence of the edge is
 * re-checked server-side rather than trusting the caller's split: articles in
 * `overwriteIds` whose edge exists are updated; articles in `addIds` whose edge
 * already exists are skipped, so a row added between load and apply is never
 * clobbered.
 */
export function bulkAddConversion(
  input: BulkConversionInput,
): BulkConversionResult {
  const { fromUnitId, toUnitId, factor, isContainer = false } = input;
  if (fromUnitId === toUnitId) {
    throw new StammdatenError("Von- und Nach-Einheit müssen verschieden sein.");
  }
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new StammdatenError("Der Faktor muss eine positive Zahl sein.");
  }
  const allIds = Array.from(new Set([...input.addIds, ...input.overwriteIds]));
  const empty: BulkConversionResult = {
    addedIds: [],
    overwrittenIds: [],
    skippedIds: [],
  };
  if (allIds.length === 0) return empty;

  // Verify both units exist — a bad id would otherwise surface as a raw FK 500.
  const units = db
    .select({ id: unitTable.id })
    .from(unitTable)
    .where(inArray(unitTable.id, [fromUnitId, toUnitId]))
    .all();
  const unitIds = new Set(units.map((u) => u.id));
  if (!unitIds.has(fromUnitId) || !unitIds.has(toUnitId)) {
    throw new StammdatenError("Einheit nicht gefunden.", 404);
  }

  // Which of the target articles already carry this exact edge.
  const existing = new Set(
    db
      .select({ ingredientId: ingredientUnitConversion.ingredientId })
      .from(ingredientUnitConversion)
      .where(
        and(
          inArray(ingredientUnitConversion.ingredientId, allIds),
          eq(ingredientUnitConversion.fromUnitId, fromUnitId),
          eq(ingredientUnitConversion.toUnitId, toUnitId),
        ),
      )
      .all()
      .map((r) => r.ingredientId),
  );
  const overwriteSet = new Set(input.overwriteIds);

  const addedIds: number[] = [];
  const overwrittenIds: number[] = [];
  const skippedIds: number[] = [];
  db.transaction((tx) => {
    for (const id of allIds) {
      if (existing.has(id)) {
        if (overwriteSet.has(id)) {
          tx.update(ingredientUnitConversion)
            .set({ factor, isContainer })
            .where(
              and(
                eq(ingredientUnitConversion.ingredientId, id),
                eq(ingredientUnitConversion.fromUnitId, fromUnitId),
                eq(ingredientUnitConversion.toUnitId, toUnitId),
              ),
            )
            .run();
          overwrittenIds.push(id);
        } else {
          skippedIds.push(id);
        }
      } else {
        tx.insert(ingredientUnitConversion)
          .values({ ingredientId: id, fromUnitId, toUnitId, factor, isContainer })
          .run();
        addedIds.push(id);
      }
    }
  });
  return { addedIds, overwrittenIds, skippedIds };
}

export type BulkDeleteConversionResult = { deletedIds: number[] };

/**
 * Remove the `(from→to)` conversion edge from many articles at once. Touches
 * only that exact pair, leaving each article's other conversions intact.
 * Returns the ids that actually had a matching row removed (a `(from→to)` pair
 * not present on an article is a silent no-op for that article).
 */
export function bulkDeleteConversion(
  fromUnitId: number,
  toUnitId: number,
  ids: number[],
): BulkDeleteConversionResult {
  if (ids.length === 0) return { deletedIds: [] };
  const targetIds = Array.from(new Set(ids));
  const matched = db
    .select({ ingredientId: ingredientUnitConversion.ingredientId })
    .from(ingredientUnitConversion)
    .where(
      and(
        inArray(ingredientUnitConversion.ingredientId, targetIds),
        eq(ingredientUnitConversion.fromUnitId, fromUnitId),
        eq(ingredientUnitConversion.toUnitId, toUnitId),
      ),
    )
    .all()
    .map((r) => r.ingredientId);
  if (matched.length === 0) return { deletedIds: [] };
  db.delete(ingredientUnitConversion)
    .where(
      and(
        inArray(ingredientUnitConversion.ingredientId, matched),
        eq(ingredientUnitConversion.fromUnitId, fromUnitId),
        eq(ingredientUnitConversion.toUnitId, toUnitId),
      ),
    )
    .run();
  return { deletedIds: matched };
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
