/**
 * When a reparse/import row keeps the user's ORIGINAL spelling as the display
 * name (adopting it as an alias) instead of the parser's matched alias, the
 * words the original name carries BEYOND the matched alias are exactly the ones
 * the parser had peeled off into the notes ("Cherry Tomaten" → alias "Tomaten",
 * note "Cherry"). Keeping the original name puts those words back into the name,
 * so they must leave the note — otherwise they'd show in both places.
 *
 * This recomputes the note for the adopted name: drop, from the parser's
 * proposed note, the word tokens the adopted name gained over the matched alias.
 */

/** Word tokens a name contributes, normalised for comparison: lowercased,
 *  split on whitespace/commas, edge punctuation stripped. */
function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((t) => t.length > 0);
}

/**
 * @param notes        the parser's proposed note for the matched alias
 * @param adoptedName  the original spelling now used as the display name
 * @param aliasName    the matched alias the parser had proposed
 * @returns the note with the name-gained words removed (null when empty)
 */
export function notesForAdoptedName(
  notes: string | null,
  adoptedName: string,
  aliasName: string,
): string | null {
  if (!notes || notes.trim().length === 0) return notes && notes.trim().length ? notes : null;
  const aliasSet = new Set(nameTokens(aliasName));
  const gained = new Set(nameTokens(adoptedName).filter((t) => !aliasSet.has(t)));
  if (gained.size === 0) return notes;
  // Rebuild clause-by-clause (", " separated) so removing a word can collapse an
  // emptied clause without disturbing the others ("Cherry, fein gehackt" with
  // gained {cherry} → "fein gehackt").
  const kept = notes
    .split(/\s*,\s*/)
    .map((clause) =>
      clause
        .split(/\s+/)
        .filter((w) => {
          const norm = w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
          return norm.length === 0 ? true : !gained.has(norm);
        })
        .join(" ")
        .trim(),
    )
    .filter((clause) => clause.length > 0);
  const result = kept.join(", ").trim();
  return result.length > 0 ? result : null;
}
