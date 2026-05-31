import { inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { ingredientUnitConversion } from "../../db/schema.ts";
import type { ConversionEdge } from "./convert.ts";

/**
 * Load every per-ingredient conversion edge for the given ingredients, grouped
 * by ingredient id. Each row maps directly to a {@link ConversionEdge}
 * (`1 from = factor × to`); container edges carry `isContainer = true`. The
 * shopping aggregator feeds these into {@link aggregateContributions} alongside
 * the global unit graph.
 */
export function loadConversionsByIngredient(
  ingredientIds: number[],
): Map<number, ConversionEdge[]> {
  const map = new Map<number, ConversionEdge[]>();
  if (ingredientIds.length === 0) return map;
  const rows = db
    .select({
      ingredientId: ingredientUnitConversion.ingredientId,
      from: ingredientUnitConversion.fromUnitId,
      to: ingredientUnitConversion.toUnitId,
      factor: ingredientUnitConversion.factor,
      isContainer: ingredientUnitConversion.isContainer,
    })
    .from(ingredientUnitConversion)
    .where(inArray(ingredientUnitConversion.ingredientId, ingredientIds))
    .all();
  for (const r of rows) {
    const arr = map.get(r.ingredientId) ?? [];
    arr.push({ from: r.from, to: r.to, factor: r.factor, isContainer: r.isContainer });
    map.set(r.ingredientId, arr);
  }
  return map;
}
