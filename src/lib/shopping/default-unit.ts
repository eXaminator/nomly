import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { ingredient, unit } from "../../db/schema.ts";

/** A unit choice for a picker: the real unit id plus the label to show. */
export type DefaultUnit = { unitId: number | null; unitName: string | null };

/**
 * The generic "Stück" fallback unit — used whenever an article has no own
 * default unit. Seeded and stable, but not memoized so a test that reseeds the
 * unit table still resolves the current row.
 */
export function getStueckUnit(): DefaultUnit {
  const row = db
    .select({ id: unit.id, name: unit.name })
    .from(unit)
    .where(eq(unit.name, "Stück"))
    .get();
  return row ? { unitId: row.id, unitName: row.name } : { unitId: null, unitName: null };
}

/**
 * Default unit for a manually-added shopping item of this article:
 * the ingredient's own `default_unit_id` (with its `default_unit_display`
 * spelling) when set, otherwise the generic "Stück". Mirrors the parser's
 * resolution order minus the alias step (the manual picker keys off the
 * article, not a matched alias).
 */
export function resolveDefaultUnitForIngredient(ingredientId: number): DefaultUnit {
  const row = db
    .select({
      defaultUnitId: ingredient.defaultUnitId,
      defaultUnitDisplay: ingredient.defaultUnitDisplay,
      unitName: unit.name,
    })
    .from(ingredient)
    .leftJoin(unit, eq(unit.id, ingredient.defaultUnitId))
    .where(eq(ingredient.id, ingredientId))
    .get();
  if (!row) return { unitId: null, unitName: null };
  if (row.defaultUnitId != null) {
    return { unitId: row.defaultUnitId, unitName: row.defaultUnitDisplay ?? row.unitName };
  }
  return getStueckUnit();
}
