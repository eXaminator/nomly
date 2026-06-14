/** Minimal shape of a quantifier needed to resolve its value. */
export type QuantifierValueRef = { value: number | null };

/**
 * The single numeric value all display/scaling/aggregation reads: the literal
 * quantity if present, else the referenced quantifier's value (which may be
 * null for an unspecified quantifier like "einige"), else null.
 */
export function effectiveQuantity(
  row: { quantity: number | null; quantifierId: number | null },
  quantifierById: ReadonlyMap<number, QuantifierValueRef>,
): number | null {
  if (row.quantity != null) return row.quantity;
  if (row.quantifierId != null) return quantifierById.get(row.quantifierId)?.value ?? null;
  return null;
}
