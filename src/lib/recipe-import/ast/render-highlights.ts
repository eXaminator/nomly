import type { HighlightKind, HighlightPart } from "../source-ranges";
import type { Leaf } from "./render-notes";

/**
 * Map a leaf to its highlight kind, mirroring the note-removal logic in
 * {@link renderNote}:
 *  - amount/unit → "amount"; ingredient → "name";
 *  - prep noun → "note" (its text leads the notes);
 *  - a pluralization marker: the suffix LETTERS belong to the matched name
 *    ("Aubergine(n)" — the "n" is part of "Auberginen") → "name"; the
 *    punctuation "(" ")" "/" around it → "dropped";
 *  - anything removed from the notes (consumed markers/connectors, root-level
 *    parens/brackets, a spaced separator dash) → "dropped";
 *  - everything kept verbatim (incl. nested parens) → "note".
 */
function kindOf(source: string, lf: Leaf): HighlightKind {
  if (lf.role === "amount" || lf.role === "unit") return "amount";
  if (lf.role === "ingredient") return "name";
  if (lf.role === "prep-noun") return "note";
  if (lf.role === "plural-marker") return lf.kind === "word" ? "name" : "dropped";
  const isParenRootDelim =
    (lf.kind === "open" || lf.kind === "close") && lf.depth === 0 && !lf.bracket;
  const isBracketDelim = (lf.kind === "open" || lf.kind === "close") && lf.bracket;
  // A dash flanked by digits ("150 - 200 g") is a numeric range — it stays part
  // of the note, not a dropped separator.
  const numBefore = /\d/.test(source.slice(0, lf.start).replace(/\s+$/u, "").slice(-1));
  const numAfter = /\d/.test(source.slice(lf.end).replace(/^\s+/u, "").slice(0, 1));
  const isSpacedDash =
    lf.kind === "dash" &&
    (lf.start === 0 || /\s/.test(source[lf.start - 1])) &&
    (lf.end >= source.length || /\s/.test(source[lf.end])) &&
    !(numBefore && numAfter);
  if (lf.consumed || isParenRootDelim || isBracketDelim || isSpacedDash) return "dropped";
  return "note";
}

/**
 * Categorised highlight spans for a row's own segment, derived directly from
 * the annotated leaves (no separate re-scan). Adjacent same-kind leaves merge
 * into one span; ranges are offsets into `source` (the piece), which the
 * caller rebases onto the full line.
 */
export function renderHighlights(source: string, leaves: readonly Leaf[]): HighlightPart[] {
  const parts: HighlightPart[] = [];
  for (const lf of leaves) {
    const kind = kindOf(source, lf);
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.range[1] = lf.end;
    else parts.push({ kind, range: [lf.start, lf.end] });
  }
  return parts;
}
