/**
 * Resolves the initial shopping-list supermarket filter from a `?supermarket=`
 * deep link and the persisted default. Pure (no DOM / storage) so it can be
 * unit-tested; the caller wires the result to React state + localStorage.
 *
 * Deep-link grammar (the query param value):
 *   - a valid store id  → select that store and persist it as the new default
 *   - `all` or empty     → reset to "Alle Supermärkte" and clear the default
 *   - anything else      → ignored; fall back to the persisted default
 * With no param at all, the persisted default is restored (without rewriting
 * it). The `all` keyword mirrors the "Alle Supermärkte" option in the filter.
 */

export type SupermarketFilterAction = {
  /**
   * Filter id to apply: a store id, or `null` for "all supermarkets".
   * `undefined` means "leave the current filter untouched".
   */
  id: number | null | undefined;
  /** What to do with the persisted default. */
  storage: "write" | "clear" | "none";
};

export function resolveSupermarketDeepLink(
  urlParam: string | null,
  stored: string | null,
  isValidId: (id: number) => boolean,
): SupermarketFilterAction {
  // An explicit deep link takes precedence over the stored default.
  if (urlParam != null) {
    if (urlParam === "all" || urlParam === "") {
      return { id: null, storage: "clear" };
    }
    const n = Number.parseInt(urlParam, 10);
    if (Number.isFinite(n) && isValidId(n)) {
      return { id: n, storage: "write" };
    }
    // Unrecognized value: ignore it and fall through to the stored default.
  }

  const s = stored == null ? Number.NaN : Number.parseInt(stored, 10);
  if (Number.isFinite(s) && isValidId(s)) {
    return { id: s, storage: "none" };
  }
  return { id: undefined, storage: "none" };
}
