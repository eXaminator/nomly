/**
 * Catalog seeder — applies `docs/familywall-ingredient-merge.md` to the
 * database. Runs after `runSeed()` (Tandoor) and before familywall import.
 *
 * Handles four entry modes:
 *  - **NEW**: insert the canonical ingredient row.
 *  - **Anchor**: existing Tandoor row — only patch category/dietary/
 *    equipment/purchaseUnit + add aliases + sub-units.
 *  - **Rename**: UPDATE the Tandoor canonical's `name`, then anchor-apply.
 *  - **Merge**: collapse N Tandoor rows into one — redirect FK references
 *    from secondaries to the primary, then delete the secondary rows.
 *
 * Idempotent. On re-run, every step is a no-op when the target state has
 * already been reached.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql, eq, and } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  category,
  ingredient,
  ingredientAlias,
  ingredientSubUnit,
  ingredientSupermarketUnavailable,
  recipeIngredient,
  shoppingItem,
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
  /** NEW canonicals inserted. */
  inserted: number;
  /** Existing rows renamed to the canonical name. */
  renamed: number;
  /** Tandoor rows redirected + removed by a merge. */
  mergedAway: number;
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

type TandoorFood = { name: string };
type TandoorSeed = { food: Record<string, TandoorFood> };

const norm = (s: string) => s.trim();
const lower = (s: string) => norm(s).toLowerCase();

function readTandoorFoodNames(): Map<string, string> {
  const path = resolve(process.cwd(), "data/seed/tandoor-de.json");
  const seed = JSON.parse(readFileSync(path, "utf8")) as TandoorSeed;
  const out = new Map<string, string>();
  for (const [key, f] of Object.entries(seed.food)) out.set(key, norm(f.name));
  return out;
}

type SeedContext = {
  tandoorFoodNames: Map<string, string>;
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
 * Loads the catalog from `docs/familywall-ingredient-merge.md` and the
 * Tandoor food-key/name map from `data/seed/tandoor-de.json`.
 */
export function runFamilywallCatalogSeed(): CatalogSeedCounts {
  const parsed = loadIngredientCatalog();
  return runFamilywallCatalogSeedWith(parsed);
}

/**
 * Inner entry point — takes a pre-parsed catalog. Tests inject a fixture
 * catalog here so they don't need the markdown on disk.
 */
export function runFamilywallCatalogSeedWith(
  parsed: ParsedCatalog,
): CatalogSeedCounts {
  const counts: CatalogSeedCounts = {
    entries: parsed.entries.length,
    inserted: 0,
    renamed: 0,
    mergedAway: 0,
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

  const tandoorFoodNames = readTandoorFoodNames();

  db.transaction((tx) => {
    const ctx: SeedContext = {
      tandoorFoodNames,
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

    // Resolution-order matters when the catalog renames row A to a name
    // that's currently a *different* entry's Tandoor source. Concretely:
    // food-spices-paprika ships under Tandoor name "Paprika"; the catalog
    // renames that row to "Paprikapulver". The "Paprika" canonical (fresh
    // peppers) belongs to a separate entry on food-bell-pepper-yellow.
    // If we process "Paprika" first, it grabs the "Paprika" row that
    // "Paprikapulver" needs to rename — destroying powder data on the way.
    //
    // Two-pass fix: defer entries whose canonical name is another entry's
    // Tandoor source. Pass 1 frees those names; pass 2 fills them.
    const tandoorNamesInUse = new Set<string>();
    for (const e of parsed.entries) {
      if (e.tandoorFoodKey === null) continue;
      const name = ctx.tandoorFoodNames.get(e.tandoorFoodKey);
      if (name) tandoorNamesInUse.add(lower(name));
      for (const k of e.mergeFoodKeys) {
        const n = ctx.tandoorFoodNames.get(k);
        if (n) tandoorNamesInUse.add(lower(n));
      }
    }
    // An entry's canonical conflicts iff it's another entry's Tandoor name
    // AND that other entry isn't this entry itself (own-name renames don't
    // count — the row already has that name).
    const pass1: CatalogEntry[] = [];
    const pass2: CatalogEntry[] = [];
    for (const entry of parsed.entries) {
      const ownTandoorName = entry.tandoorFoodKey
        ? lower(ctx.tandoorFoodNames.get(entry.tandoorFoodKey) ?? "")
        : null;
      const canonicalIsOwnTandoor = ownTandoorName === lower(entry.canonicalName);
      if (
        !canonicalIsOwnTandoor &&
        tandoorNamesInUse.has(lower(entry.canonicalName))
      ) {
        pass2.push(entry);
      } else {
        pass1.push(entry);
      }
    }

    const resolved: Array<{ entry: CatalogEntry; ingredientId: number }> = [];
    for (const entry of pass1) {
      const id = resolveTargetIngredient(tx, ctx, entry);
      if (id !== null) resolved.push({ entry, ingredientId: id });
    }
    for (const entry of pass2) {
      const id = resolveTargetIngredient(tx, ctx, entry);
      if (id !== null) resolved.push({ entry, ingredientId: id });
    }

    for (const { entry, ingredientId } of resolved) {
      applyEntryMetadata(tx, ctx, entry, ingredientId);
      applyEntryAliases(tx, ctx, entry, ingredientId);
      applyEntrySubUnit(tx, ctx, entry, ingredientId);
    }
  });

  return counts;
}

/**
 * Locate (or create / rename) the ingredient row this entry should point at,
 * returning its id. Returns null if the entry can't be resolved (logged as a
 * warning).
 *
 * Resolution rules (food-key first so rename + merge stays deterministic
 * even when both the Tandoor row and a stray canonical-named row exist):
 *
 *   NEW                → find or insert by canonical name
 *   Anchor / rename    → find row at the Tandoor name. If row is already
 *                        at the canonical name (idempotent re-run), keep
 *                        it. If a different row also owns the canonical
 *                        name, merge the Tandoor row into it.
 *   Merge              → resolve the primary as above, then merge each
 *                        secondary food-key's row into the primary.
 */
function resolveTargetIngredient(
  tx: Tx,
  ctx: SeedContext,
  entry: CatalogEntry,
): number | null {
  const canonicalLower = lower(entry.canonicalName);

  if (entry.tandoorFoodKey === null) {
    // NEW: find or insert by canonical name.
    let id = ctx.ingredientIdByName.get(canonicalLower);
    if (id !== undefined) return id;
    const inserted = tx
      .insert(ingredient)
      .values({ name: entry.canonicalName })
      .returning({ id: ingredient.id })
      .all();
    id = inserted[0].id;
    ctx.ingredientIdByName.set(canonicalLower, id);
    ctx.counts.inserted += 1;
    return id;
  }

  const primaryId = resolveFoodKey(tx, ctx, entry.tandoorFoodKey, entry.canonicalName);
  if (primaryId === null) {
    ctx.counts.warnings.push(
      `${entry.canonicalName}: tandoor key ${entry.tandoorFoodKey} not in DB (looked for "${
        ctx.tandoorFoodNames.get(entry.tandoorFoodKey) ?? "?"
      }" and "${entry.canonicalName}")`,
    );
    return null;
  }

  // Merges: collapse each secondary food-key's row into the primary.
  for (const secondaryKey of entry.mergeFoodKeys) {
    const secondaryName = ctx.tandoorFoodNames.get(secondaryKey);
    if (!secondaryName) {
      ctx.counts.warnings.push(
        `${entry.canonicalName}: merge target ${secondaryKey} not in Tandoor seed`,
      );
      continue;
    }
    const secondaryId = ctx.ingredientIdByName.get(lower(secondaryName));
    if (secondaryId === undefined) continue; // already merged on a prior run
    if (secondaryId === primaryId) continue;
    mergeIngredient(tx, ctx, secondaryId, primaryId);
    ctx.ingredientIdByName.delete(lower(secondaryName));
    ctx.counts.mergedAway += 1;
  }

  return primaryId;
}

/**
 * Find the ingredient row corresponding to `foodKey`.
 *
 * - If a row with `canonicalName` already exists (idempotent re-run, or
 *   user pre-created the row), return it. Don't go hunting for the Tandoor-
 *   named row — its name may have been reused by another catalog entry's
 *   canonical (food-spices-paprika ↔ Paprika fresh peppers is the canonical
 *   example), and merging it in would destroy the wrong data.
 * - Otherwise rename the Tandoor row to canonical and return it.
 * - If neither exists, return null (caller warns).
 */
function resolveFoodKey(
  tx: Tx,
  ctx: SeedContext,
  foodKey: string,
  canonicalName: string,
): number | null {
  const canonicalLower = lower(canonicalName);
  const tandoorName = ctx.tandoorFoodNames.get(foodKey);
  const tandoorNameLower = tandoorName ? lower(tandoorName) : null;

  const canonicalId = ctx.ingredientIdByName.get(canonicalLower);
  if (canonicalId !== undefined) return canonicalId;

  if (tandoorNameLower !== null) {
    const tandoorId = ctx.ingredientIdByName.get(tandoorNameLower);
    if (tandoorId !== undefined) {
      // Rename (or no-op when names already match).
      if (tandoorNameLower !== canonicalLower) {
        tx.update(ingredient)
          .set({ name: canonicalName })
          .where(eq(ingredient.id, tandoorId))
          .run();
        ctx.ingredientIdByName.delete(tandoorNameLower);
        ctx.ingredientIdByName.set(canonicalLower, tandoorId);
        ctx.counts.renamed += 1;
      }
      return tandoorId;
    }
  }

  return null;
}

/**
 * Redirect every FK reference from `fromId` to `toId`, then delete `fromId`.
 * Order matters: shopping_item_source FKs cascade through shopping_item /
 * recipe_ingredient, so we don't need to touch them directly.
 */
function mergeIngredient(tx: Tx, ctx: SeedContext, fromId: number, toId: number): void {
  // recipe_ingredient FK
  tx.update(recipeIngredient)
    .set({ ingredientId: toId })
    .where(eq(recipeIngredient.ingredientId, fromId))
    .run();

  // shopping_item FK
  tx.update(shoppingItem)
    .set({ ingredientId: toId })
    .where(eq(shoppingItem.ingredientId, fromId))
    .run();

  // ingredient_supermarket_unavailable: move rows over but dedupe — the
  // primary may already be marked unavailable at the same supermarket.
  const flags = tx
    .select({ supermarketId: ingredientSupermarketUnavailable.supermarketId })
    .from(ingredientSupermarketUnavailable)
    .where(eq(ingredientSupermarketUnavailable.ingredientId, fromId))
    .all();
  tx.delete(ingredientSupermarketUnavailable)
    .where(eq(ingredientSupermarketUnavailable.ingredientId, fromId))
    .run();
  for (const flag of flags) {
    const exists = tx
      .select({ ingredientId: ingredientSupermarketUnavailable.ingredientId })
      .from(ingredientSupermarketUnavailable)
      .where(
        and(
          eq(ingredientSupermarketUnavailable.ingredientId, toId),
          eq(ingredientSupermarketUnavailable.supermarketId, flag.supermarketId),
        ),
      )
      .get();
    if (!exists) {
      tx.insert(ingredientSupermarketUnavailable)
        .values({ ingredientId: toId, supermarketId: flag.supermarketId })
        .run();
    }
  }

  // ingredient_alias: move aliases over, but skip names that collide with
  // existing aliases on the primary (the schema's UNIQUE constraint would
  // otherwise reject the move).
  const aliases = tx
    .select({ id: ingredientAlias.id, name: ingredientAlias.name })
    .from(ingredientAlias)
    .where(eq(ingredientAlias.ingredientId, fromId))
    .all();
  for (const alias of aliases) {
    const collision = tx
      .select({ id: ingredientAlias.id })
      .from(ingredientAlias)
      .where(
        and(
          eq(ingredientAlias.ingredientId, toId),
          sql`lower(${ingredientAlias.name}) = ${lower(alias.name)}`,
        ),
      )
      .get();
    if (collision) {
      tx.delete(ingredientAlias).where(eq(ingredientAlias.id, alias.id)).run();
    } else {
      tx.update(ingredientAlias)
        .set({ ingredientId: toId })
        .where(eq(ingredientAlias.id, alias.id))
        .run();
      ctx.aliasByName.set(lower(alias.name), toId);
    }
  }

  // ingredient_sub_unit: move sub-units over, deduping by name. Aliases that
  // pointed at a removed sub-unit are NOT auto-rewired — sub-units are
  // ingredient-scoped, so a duplicate-named sub-unit on the primary is the
  // canonical home for any alias references on either side.
  const subs = tx
    .select({
      id: ingredientSubUnit.id,
      name: ingredientSubUnit.name,
      perPurchase: ingredientSubUnit.perPurchase,
    })
    .from(ingredientSubUnit)
    .where(eq(ingredientSubUnit.ingredientId, fromId))
    .all();
  for (const sub of subs) {
    const collision = tx
      .select({ id: ingredientSubUnit.id })
      .from(ingredientSubUnit)
      .where(
        and(
          eq(ingredientSubUnit.ingredientId, toId),
          sql`lower(${ingredientSubUnit.name}) = ${lower(sub.name)}`,
        ),
      )
      .get();
    if (collision) {
      // Re-point any alias that defaulted to the duplicate sub-unit.
      tx.update(ingredientAlias)
        .set({ defaultSubUnitId: collision.id })
        .where(eq(ingredientAlias.defaultSubUnitId, sub.id))
        .run();
      tx.delete(ingredientSubUnit).where(eq(ingredientSubUnit.id, sub.id)).run();
    } else {
      tx.update(ingredientSubUnit)
        .set({ ingredientId: toId })
        .where(eq(ingredientSubUnit.id, sub.id))
        .run();
    }
  }

  // Delete the secondary. shopping_item_source rows reference recipe_
  // ingredient + shopping_item, both of which we've already re-pointed, so
  // the cascade here only affects rows we don't care about.
  tx.delete(ingredient).where(eq(ingredient.id, fromId)).run();
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

  if (entry.purchaseUnit) {
    const unitId = ctx.unitIdByName.get(lower(entry.purchaseUnit));
    if (unitId === undefined) {
      ctx.counts.warnings.push(
        `${entry.canonicalName}: unknown purchaseUnit "${entry.purchaseUnit}"`,
      );
    } else {
      updates.purchaseUnitId = unitId;
    }
  }

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

  let subUnitId: number;
  const existing = tx
    .select({ id: ingredientSubUnit.id, perPurchase: ingredientSubUnit.perPurchase })
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
    // Preserve user-edited perPurchase values: only update if the existing
    // value is the schema default (1) AND the catalog provides something
    // more specific. Same convention as runSeed's sub-unit top-up loop.
    if (existing.perPurchase === 1 && entry.subUnit.perPurchase !== 1) {
      tx.update(ingredientSubUnit)
        .set({ perPurchase: entry.subUnit.perPurchase })
        .where(eq(ingredientSubUnit.id, subUnitId))
        .run();
    }
  } else {
    const inserted = tx
      .insert(ingredientSubUnit)
      .values({
        ingredientId,
        name: subName,
        perPurchase: entry.subUnit.perPurchase,
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
    // If the owner is the same ingredient and a sub-unit was requested,
    // top up the FK so a re-run after adding sub-unit aliases works.
    if (existingOwner === ingredientId && defaultSubUnitId !== null) {
      tx.update(ingredientAlias)
        .set({ defaultSubUnitId })
        .where(
          and(
            eq(ingredientAlias.ingredientId, ingredientId),
            sql`lower(${ingredientAlias.name}) = ${key}`,
          ),
        )
        .run();
    }
    return false;
  }

  try {
    tx.insert(ingredientAlias)
      .values({ ingredientId, name, defaultSubUnitId: defaultSubUnitId ?? null })
      .run();
    ctx.aliasByName.set(key, ingredientId);
    return true;
  } catch {
    // Race with another row inserted earlier in the same run that we didn't
    // see in the cache (e.g. case-only collision). The schema's UNIQUE
    // rejected the insert; treat as a skip.
    return false;
  }
}
