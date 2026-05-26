/**
 * Single helper for "is this recipe ingredient row treated as optional?"
 *
 * An ingredient is effectively optional when ANY of these hold:
 *   - the user (or importer) flagged it `isOptional`
 *   - the form-level `isAlternative` flag is true (i.e. this row was
 *     created as an alternative under another primary)
 *   - the server-side `alternative_for_id` is non-null (the persisted
 *     version of the same relationship)
 *
 * The same predicate gates display dimming (recipe view + planner
 * preview), default shopping-list selection, diet calculation, and the
 * impact-section usage badges. Wire every call site through this helper
 * so the "alternatives are always optional" invariant lives in exactly
 * one place.
 */
export type OptionalishIngredient = {
  isOptional: boolean;
  isAlternative?: boolean;
  alternativeForId?: number | null;
};

export function isOptionalIngredient(ing: OptionalishIngredient): boolean {
  return (
    ing.isOptional ||
    ing.isAlternative === true ||
    (ing.alternativeForId ?? null) !== null
  );
}
