export type Dimension = "mass" | "volume" | "count";

export type UnitRow = {
  id: number;
  name: string;
  dimension: Dimension;
  baseUnitId: number | null;
  factor: number;
};

/**
 * `qty * unit.factor` is the quantity expressed in the dimension's base unit
 * (e.g. grams for mass, ml for volume). A unit with `baseUnitId = null` is
 * itself the base; otherwise factor relates it to the base unit's row.
 */
export function toBaseQuantity(qty: number, u: UnitRow): number {
  return qty * u.factor;
}

/**
 * Pick the "largest sensible unit" for a base quantity within a dimension:
 *   1200g → 1.2 kg, 50ml → 50 ml, 1500ml → 1.5 l.
 *
 * Strategy: among all candidate units in the same dimension, pick the one
 * whose factor is the largest yet still yields a value ≥ 1 in that unit.
 * Falls back to the smallest-factor unit if none qualifies.
 *
 * `candidates` may include unrelated dimensions — they're filtered here.
 */
export function pickDisplayUnit(
  baseQty: number,
  dimension: Dimension,
  candidates: UnitRow[],
): { qty: number; unit: UnitRow } | null {
  const inDim = candidates.filter((u) => u.dimension === dimension);
  if (inDim.length === 0) return null;
  const sorted = [...inDim].sort((a, b) => b.factor - a.factor);
  for (const u of sorted) {
    const q = baseQty / u.factor;
    if (q >= 1) return { qty: q, unit: u };
  }
  const smallest = sorted[sorted.length - 1];
  return { qty: baseQty / smallest.factor, unit: smallest };
}

/**
 * Format a numeric quantity for display: up to 2 decimal places, comma
 * decimal separator (de-DE). Whole numbers print without a decimal.
 */
export function formatQty(qty: number): string {
  const rounded = Math.round(qty * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded
    .toFixed(2)
    .replace(/0+$/, "")
    .replace(/\.$/, "")
    .replace(".", ",");
}
