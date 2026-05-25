/**
 * Types + lookup for the familywall ingredient catalog. The actual data
 * lives in `./ingredient-catalog-data.ts` (hand-edited TS array).
 *
 * The catalog is consumed by `./seed-catalog.ts` which applies each entry
 * to the DB (NEW/anchor/rename/merge modes, aliases, sub-units, category,
 * dietary class, equipment flag, purchase unit).
 */

import { INGREDIENT_CATALOG } from "./ingredient-catalog-data.ts";

export type Dietary = "vegan" | "vegetarian" | "meat" | "undecided";

export type CatalogSubUnit = {
  name: string;
  perPurchase: number;
};

export type CatalogEntry = {
  /** Section/category heading the entry originally belonged to (kept for
   *  diagnostics only — the seeder uses `category`). */
  section: string;
  /** Canonical German singular as written in the data file. */
  canonicalName: string;
  /** Category name. Looked up against the `category` table. */
  category: string | null;
  /** Diet class (`undecided` = leave NULL). */
  dietary: Dietary;
  /** When true, the seeder sets `ingredient.is_equipment = true`. */
  equipment: boolean;
  /** Cross-language + alternate-spelling aliases (no defaults attached). */
  aliases: string[];
  /** Default purchase unit name (looked up against `unit.name`), or null. */
  purchaseUnit: string | null;
  /** Sub-unit definition, or null. */
  subUnit: CatalogSubUnit | null;
  /**
   * Compound-noun aliases that imply the sub-unit (e.g. "Knoblauchzehe"
   * implies sub-unit "Zehe" on Knoblauch). Each is inserted as an alias
   * with `default_sub_unit_id` pointing at the sub-unit row.
   */
  subUnitAliases: string[];
  /** Free-form notes (not used by the seeder; kept for diagnostics). */
  notes: string | null;
};

export type ParsedCatalog = {
  entries: CatalogEntry[];
  warnings: never[];
};

/**
 * Return the in-code catalog. The `warnings` array is always empty — kept
 * in the return shape for backwards compatibility with the seeder, which
 * used to surface markdown parser warnings here.
 */
export function loadIngredientCatalog(): ParsedCatalog {
  return { entries: INGREDIENT_CATALOG, warnings: [] };
}

/**
 * Walk catalog entries and surface global alias collisions (alias listed
 * on two different canonicals). The schema enforces
 * `ingredient_alias.name` uniqueness globally, so a collision here would
 * surface as a swallowed exception in the seeder.
 *
 * Returns an empty array on success. Each collision lists the alias and
 * the canonicals that conflict.
 */
export function findAliasCollisions(
  entries: CatalogEntry[],
): Array<{ alias: string; canonicals: string[] }> {
  const aliasToOwners = new Map<string, Set<string>>();
  for (const entry of entries) {
    const all = [...entry.aliases, ...entry.subUnitAliases];
    for (const aliasRaw of all) {
      const key = aliasRaw.toLowerCase();
      if (!aliasToOwners.has(key)) aliasToOwners.set(key, new Set());
      aliasToOwners.get(key)!.add(entry.canonicalName);
    }
  }
  const collisions: Array<{ alias: string; canonicals: string[] }> = [];
  for (const [alias, owners] of aliasToOwners) {
    if (owners.size > 1) {
      collisions.push({ alias, canonicals: Array.from(owners).sort() });
    }
  }
  collisions.sort((a, b) => a.alias.localeCompare(b.alias));
  return collisions;
}
