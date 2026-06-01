/**
 * Client-safe autocomplete helpers. Kept separate from `autocomplete.ts`, which
 * imports the database and so cannot be pulled into a client bundle.
 */

/**
 * Decide which name suggestions the freeform ingredient autocomplete should
 * show for the current query. Hide the dropdown only when the *sole* suggestion
 * is exactly what's typed (no useful hint to add); otherwise keep every
 * suggestion — including the exact match — so the server's exact-first order
 * stands and completing a word never strands a longer match as the selected
 * (Tab/Enter) option.
 */
export function dropdownSuggestions<T extends { name: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (items.length === 1 && items[0].name.toLowerCase() === q) return [];
  return [...items];
}
