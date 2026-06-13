import type { Lexeme } from "./lexer";

/** The role a semantic pass assigned to a token. Drives highlight kinds and
 *  documents why a token was consumed. */
export type Role =
  | "amount"
  | "unit"
  | "ingredient"
  | "connector"
  | "optional-marker"
  | "prep-noun"
  // Pluralization-marker punctuation ("(" ")" "/" in "Ei(er)", "Dose/n"): the
  // letters glue to the base word for matching/display; this punctuation is
  // transparent — dropped from notes/highlights, never a comma boundary.
  | "plural-marker";

/** A lexeme annotated by the semantic passes. `consumed` marks a token that a
 *  structured field claimed (amount / unit / ingredient / connector / optional
 *  marker) — consumed tokens leave the note and become a comma boundary. */
export type Leaf = Lexeme & {
  consumed?: boolean;
  role?: Role;
  /** Set when this leaf begins a folded-in alternative that is NOT source-
   *  adjacent to the preceding leaf (a row-alternative was skipped between
   *  them). Tells {@link renderNote} to start a fresh `, ` clause rather than
   *  slice the intervening source. */
  breakBefore?: boolean;
};

/**
 * Render a row's note from its leaves, per the note rule:
 *  - consumed tokens are removed; a removed run between survivors → a single `, `;
 *  - root-level parentheses and brackets are unwrapped (delimiters dropped, the
 *    boundary becomes `, `); nested parentheses are kept verbatim;
 *  - everything else is emitted byte-for-byte from the original gaps;
 *  - comma/space runs collapse, edges trim, empty → null.
 */
/** A leaf that's dropped from the note: consumed by a field, a root-level paren
 *  or bracket delimiter, or a pluralization marker. */
function isRemovedFromNote(lf: Leaf): boolean {
  const isParenRootDelim =
    (lf.kind === "open" || lf.kind === "close") && lf.depth === 0 && !lf.bracket;
  const isBracketDelim = (lf.kind === "open" || lf.kind === "close") && lf.bracket;
  // A dash the parser DIDN'T consume survives verbatim ("150 - 200 g") — not
  // listed here. Comma boundaries come from CONSUMED spans.
  return (
    lf.consumed === true || isParenRootDelim || isBracketDelim || lf.role === "plural-marker"
  );
}

export function renderNote(source: string, leaves: readonly Leaf[]): string | null {
  let out = "";
  let lastEnd = -1;
  let pendingBreak = false;
  let started = false;

  for (let idx = 0; idx < leaves.length; idx++) {
    const lf = leaves[idx];
    // A pluralization marker ("(er)", "/n") is dropped like a paren but never
    // introduces a comma boundary.
    const isPluralMarker = lf.role === "plural-marker";
    if (isRemovedFromNote(lf)) {
      if (started && !isPluralMarker) pendingBreak = true;
      continue;
    }
    // A footnote "*" GLUED to a following surviving token ("*siehe") attaches
    // forward — render it normally so it stays with that token. Otherwise (a
    // trailing "*", or one glued only to a dropped ")" — "(gemahlen)*") it
    // attaches to the PRECEDING note text, never a new comma clause.
    const next = leaves[idx + 1];
    const starGluedForward =
      lf.text === "*" && next != null && next.start === lf.end && !isRemovedFromNote(next);

    if (!started) {
      out = lf.text;
      started = true;
    } else if (lf.text === "*" && !starGluedForward) {
      out += lf.text;
    } else {
      // `breakBefore` marks a leaf whose preceding source is NOT contiguous with
      // the previous surviving leaf — set by a fold that renders the primary +
      // a non-adjacent alternative, skipping a row-alternative in between.
      // Slicing the source there would inject the skipped text, so break.
      out += (pendingBreak || lf.breakBefore ? ", " : source.slice(lastEnd, lf.start)) + lf.text;
    }
    lastEnd = lf.end;
    pendingBreak = false;
  }
  return tidyNote(out);
}

/** Collapse whitespace + comma runs, trim edge separators; empty → null. */
export function tidyNote(s: string): string | null {
  const t = s
    // Drop invisible formatting chars (soft hyphen, zero-width, BOM).
    .replace(/[­​-‍﻿]/gu, "")
    .replace(/\s+/g, " ")
    // Normalise comma separators to ", " — but leave a German decimal comma
    // ("0,4") untouched (no spaces, flanked by digits).
    .replace(/\s*,\s*/g, (m, offset: number, str: string) => {
      if (m === "," && /\d/.test(str[offset - 1] ?? "") && /\d/.test(str[offset + 1] ?? "")) {
        return ",";
      }
      return ", ";
    })
    .replace(/(?:,\s*){2,}/g, ", ")
    // A spaced dash right next to a comma boundary is redundant — the comma
    // (from a removed span) already separates the clauses, so drop the dash
    // ("small head, - sliced" → "small head, sliced"). A dash NOT adjacent to a
    // comma survives ("150 - 200 g", "fein - gehackt").
    .replace(/,\s*[-–—]\s+/g, ", ")
    .replace(/\s+[-–—]\s*,/g, ",")
    // Trim stray edge punctuation left by a removed boundary word — a dangling
    // connector ("/", a dash), comma, colon etc. A LEADING "*" is kept: it's a
    // footnote marker referencing info elsewhere ("* organic if available"), not
    // a leftover separator. Paired delimiters ("(", "[") are already preserved
    // (they're never in the strip set). Mid-note punctuation (a ";" between
    // clauses) is untouched. "!"/"?" are kept: meaningful sentence punctuation
    // the user actually wrote ("(doch, wirklich!)").
    .replace(/^[\s,;:."'·\-–—/]+/, "")
    .replace(/[\s,;:"'·\-–—/]+$/, "")
    .trim();
  return t.length > 0 ? t : null;
}
