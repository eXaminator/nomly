/**
 * Catalog seeder — applies the in-code `INGREDIENT_CATALOG` to the database.
 * Runs after `runSeed()` (which seeds units + categories) and before
 * familywall import. The catalog is the single source of truth for
 * ingredient identity, aliases, sub-units, and metadata.
 *
 * Per-entry behaviour:
 *  - Find an existing row by canonical name, or insert a new one.
 *  - Apply metadata (category / dietary / equipment / purchaseUnit).
 *  - Insert any missing aliases.
 *  - Insert any missing sub-unit + sub-unit-implying aliases.
 *
 * Idempotent. On re-run every step is a no-op when the target state has
 * already been reached. Existing rows whose names match the catalog
 * canonical are reused, so historic data carries forward.
 */

import { sql, eq, and } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  category,
  ingredient,
  ingredientAlias,
  ingredientSubUnit,
  unit,
} from "../../db/schema.ts";
import {
  loadIngredientCatalog,
  findAliasCollisions,
  type CatalogEntry,
  type ParsedCatalog,
} from "./ingredient-catalog.ts";

export type CatalogSeedCounts = {
  /** Catalog entries the seeder processed. */
  entries: number;
  /** NEW canonicals inserted (no existing row with that name). */
  inserted: number;
  /** Catalog entries that updated category / dietary / equipment / purchaseUnit. */
  metadataApplied: number;
  /** New ingredient_alias rows inserted (skipped duplicates don't count). */
  aliasesAdded: number;
  /** New ingredient_sub_unit rows inserted (skipped if one already existed). */
  subUnitsAdded: number;
  /** New compound-noun aliases inserted with default_sub_unit_id. */
  subUnitAliasesAdded: number;
  /** Warnings surfaced during the run (missing rows, unknown categories, etc.). */
  warnings: string[];
};

const norm = (s: string) => s.trim();
const lower = (s: string) => norm(s).toLowerCase();

type SeedContext = {
  /** name (lowercased) → ingredient.id. Rebuilt as we go. */
  ingredientIdByName: Map<string, number>;
  /** category name (lowercased) → category.id. */
  categoryIdByName: Map<string, number>;
  /** unit name (lowercased) → unit.id. */
  unitIdByName: Map<string, number>;
  counts: CatalogSeedCounts;
  /** Globally-known aliases (lowercased), keyed to their owning ingredient
   *  id. Used to skip duplicate-alias inserts cheaply without round-tripping. */
  aliasByName: Map<string, number>;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Run the catalog seeder against the live DB. Returns counts + warnings.
 */
export function runFamilywallCatalogSeed(): CatalogSeedCounts {
  const parsed = loadIngredientCatalog();
  return runFamilywallCatalogSeedWith(parsed);
}

/**
 * Inner entry point — takes a pre-parsed catalog. Tests inject a fixture
 * catalog here so they don't have to round-trip through the data file.
 */
export function runFamilywallCatalogSeedWith(
  parsed: ParsedCatalog,
): CatalogSeedCounts {
  const counts: CatalogSeedCounts = {
    entries: parsed.entries.length,
    inserted: 0,
    metadataApplied: 0,
    aliasesAdded: 0,
    subUnitsAdded: 0,
    subUnitAliasesAdded: 0,
    warnings: [],
  };

  const collisions = findAliasCollisions(parsed.entries);
  for (const c of collisions) {
    counts.warnings.push(
      `alias-collision: "${c.alias}" claimed by ${c.canonicals.join(" / ")} — only the first owner will receive it`,
    );
  }

  db.transaction((tx) => {
    const ctx: SeedContext = {
      ingredientIdByName: new Map(),
      categoryIdByName: new Map(),
      unitIdByName: new Map(),
      counts,
      aliasByName: new Map(),
    };
    for (const row of tx.select().from(ingredient).all()) {
      ctx.ingredientIdByName.set(lower(row.name), row.id);
    }
    for (const row of tx.select().from(category).all()) {
      ctx.categoryIdByName.set(lower(row.name), row.id);
    }
    for (const row of tx.select().from(unit).all()) {
      ctx.unitIdByName.set(lower(row.name), row.id);
    }
    for (const row of tx.select().from(ingredientAlias).all()) {
      ctx.aliasByName.set(lower(row.name), row.ingredientId);
    }

    for (const entry of parsed.entries) {
      const id = findOrInsertCanonical(tx, ctx, entry.canonicalName);
      applyEntryMetadata(tx, ctx, entry, id);
      applyEntryAliases(tx, ctx, entry, id);
      applyEntrySubUnit(tx, ctx, entry, id);
    }
  });

  return counts;
}

/**
 * Look up a row by canonical name, inserting one if absent. The lookup is
 * case-insensitive (matches the global aliasing convention) but inserts
 * preserve the catalog's exact spelling.
 */
function findOrInsertCanonical(
  tx: Tx,
  ctx: SeedContext,
  canonicalName: string,
): number {
  const canonicalLower = lower(canonicalName);
  const existingId = ctx.ingredientIdByName.get(canonicalLower);
  if (existingId !== undefined) return existingId;
  const inserted = tx
    .insert(ingredient)
    .values({ name: canonicalName })
    .returning({ id: ingredient.id })
    .all();
  const id = inserted[0].id;
  ctx.ingredientIdByName.set(canonicalLower, id);
  ctx.counts.inserted += 1;
  return id;
}

function applyEntryMetadata(
  tx: Tx,
  ctx: SeedContext,
  entry: CatalogEntry,
  ingredientId: number,
): void {
  const updates: Record<string, unknown> = {};

  if (entry.category) {
    const categoryId = ctx.categoryIdByName.get(lower(entry.category));
    if (categoryId === undefined) {
      ctx.counts.warnings.push(
        `${entry.canonicalName}: unknown category "${entry.category}"`,
      );
    } else {
      updates.defaultCategoryId = categoryId;
    }
  }

  if (entry.dietary !== "undecided") {
    updates.dietaryClass = entry.dietary;
  }

  if (entry.equipment) updates.isEquipment = true;
  if (entry.excludeFromShoppingList) updates.excludeFromShoppingList = true;

  if (Object.keys(updates).length === 0) return;
  tx.update(ingredient)
    .set(updates)
    .where(eq(ingredient.id, ingredientId))
    .run();
  ctx.counts.metadataApplied += 1;
}

function applyEntryAliases(
  tx: Tx,
  ctx: SeedContext,
  entry: CatalogEntry,
  ingredientId: number,
): void {
  for (const aliasRaw of entry.aliases) {
    const name = norm(aliasRaw);
    if (name.length === 0) continue;
    if (insertIngredientAlias(tx, ctx, ingredientId, name, null)) {
      ctx.counts.aliasesAdded += 1;
    }
  }
}

function applyEntrySubUnit(
  tx: Tx,
  ctx: SeedContext,
  entry: CatalogEntry,
  ingredientId: number,
): void {
  if (!entry.subUnit) return;
  const subName = norm(entry.subUnit.name);
  if (subName.length === 0) return;

  // The catalog's `purchaseUnit` is the parent the sub-unit converts into;
  // `perPurchase` (custom units per parent) maps to `1 ⟨sub⟩ = 1/perPurchase
  // ⟨parent⟩`. No purchase unit ⇒ standalone (parent null), matching the
  // migration's behaviour-preserving rule.
  const parentUnitId = entry.purchaseUnit
    ? ctx.unitIdByName.get(lower(entry.purchaseUnit)) ?? null
    : null;
  if (entry.purchaseUnit && parentUnitId == null) {
    ctx.counts.warnings.push(
      `${entry.canonicalName}: unknown purchaseUnit "${entry.purchaseUnit}"`,
    );
  }
  const parentAmount =
    parentUnitId != null && entry.subUnit.perPurchase > 0
      ? 1 / entry.subUnit.perPurchase
      : 1;

  let subUnitId: number;
  const existing = tx
    .select({
      id: ingredientSubUnit.id,
      parentUnitId: ingredientSubUnit.parentUnitId,
      parentAmount: ingredientSubUnit.parentAmount,
    })
    .from(ingredientSubUnit)
    .where(
      and(
        eq(ingredientSubUnit.ingredientId, ingredientId),
        sql`lower(${ingredientSubUnit.name}) = ${lower(subName)}`,
      ),
    )
    .get();
  if (existing) {
    subUnitId = existing.id;
    // Preserve user-edited conversions: only fill in the parent when the
    // existing row is still at the schema default (standalone, amount 1) AND
    // the catalog provides a parent. Mirrors the metadata top-up convention.
    if (
      existing.parentUnitId == null &&
      existing.parentAmount === 1 &&
      parentUnitId != null
    ) {
      tx.update(ingredientSubUnit)
        .set({ parentUnitId, parentAmount })
        .where(eq(ingredientSubUnit.id, subUnitId))
        .run();
    }
  } else {
    const inserted = tx
      .insert(ingredientSubUnit)
      .values({
        ingredientId,
        name: subName,
        parentUnitId,
        parentAmount,
      })
      .returning({ id: ingredientSubUnit.id })
      .all();
    subUnitId = inserted[0].id;
    ctx.counts.subUnitsAdded += 1;
  }

  for (const aliasRaw of entry.subUnitAliases) {
    const name = norm(aliasRaw);
    if (name.length === 0) continue;
    if (insertIngredientAlias(tx, ctx, ingredientId, name, subUnitId)) {
      ctx.counts.subUnitAliasesAdded += 1;
    }
  }
}

/**
 * Try to insert an alias. Skips silently if the alias name already exists
 * (the schema's global UNIQUE constraint owns the collision rule). Updates
 * the ctx cache so subsequent inserts in the same run see this alias.
 */
function insertIngredientAlias(
  tx: Tx,
  ctx: SeedContext,
  ingredientId: number,
  name: string,
  defaultSubUnitId: number | null,
): boolean {
  const key = lower(name);
  const existingOwner = ctx.aliasByName.get(key);
  if (existingOwner !== undefined) {
    if (existingOwner !== ingredientId) {
      // Globally unique alias already attached to a different ingredient.
      // findAliasCollisions warned about this up front; skip here.
      return false;
    }
    // Same owner — top up the FK so a re-run after adding sub-unit aliases
    // works.
    if (defaultSubUnitId !== null) {
      tx.update(ingredientAlias)
        .set({ defaultSubUnitId })
        .where(
          and(
            eq(ingredientAlias.ingredientId, ingredientId),
            sql`lower(${ingredientAlias.name}) = ${key}`,
            sql`${ingredientAlias.defaultSubUnitId} IS NULL`,
          ),
        )
        .run();
    }
    return false;
  }
  tx.insert(ingredientAlias)
    .values({ ingredientId, name, defaultSubUnitId })
    .run();
  ctx.aliasByName.set(key, ingredientId);
  return true;
}
