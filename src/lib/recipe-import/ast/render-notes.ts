import type { Lexeme } from "./lexer";

/** The role a semantic pass assigned to a token. Drives highlight kinds and
 *  documents why a token was consumed. */
export type Role =
  | "amount"
  | "unit"
  | "ingredient"
  | "connector"
  | "optional-marker"
  | "prep-noun";

/** A lexeme annotated by the semantic passes. `consumed` marks a token that a
 *  structured field claimed (amount / unit / ingredient / connector / optional
 *  marker) — consumed tokens leave the note and become a comma boundary. */
export type Leaf = Lexeme & { consumed?: boolean; role?: Role };

/**
 * Render a row's note from its leaves, per the note rule:
 *  - consumed tokens are removed; a removed run between survivors → a single `, `;
 *  - root-level parentheses and brackets are unwrapped (delimiters dropped, the
 *    boundary becomes `, `); nested parentheses are kept verbatim;
 *  - everything else is emitted byte-for-byte from the original gaps;
 *  - comma/space runs collapse, edges trim, empty → null.
 */
export function renderNote(source: string, leaves: readonly Leaf[]): string | null {
  let out = "";
  let lastEnd = -1;
  let pendingBreak = false;
  let started = false;

  for (const lf of leaves) {
    const isParenRootDelim =
      (lf.kind === "open" || lf.kind === "close") && lf.depth === 0 && !lf.bracket;
    const isBracketDelim = (lf.kind === "open" || lf.kind === "close") && lf.bracket;
    // A dash with whitespace on either side is a SEPARATOR the user wrote
    // ("Kohl - in Streifen") → it becomes a comma boundary. An intra-word dash
    // ("1-inch", "whole-wheat") has no surrounding space and stays verbatim.
    const isSpacedDash =
      lf.kind === "dash" &&
      ((lf.start === 0 || /\s/.test(source[lf.start - 1])) ||
        (lf.end >= source.length || /\s/.test(source[lf.end])));
    const removed = lf.consumed === true || isParenRootDelim || isBracketDelim || isSpacedDash;

    if (removed) {
      if (started) pendingBreak = true;
      continue;
    }
    if (!started) {
      out = lf.text;
      started = true;
    } else {
      out += (pendingBreak ? ", " : source.slice(lastEnd, lf.start)) + lf.text;
    }
    lastEnd = lf.end;
    pendingBreak = false;
  }
  return tidyNote(out);
}

/** Collapse whitespace + comma runs, trim edge separators; empty → null. */
export function tidyNote(s: string): string | null {
  const t = s
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    // Trim stray edge punctuation left by a removed boundary word — a dangling
    // connector dash, a trailing "!" etc. Mid-note punctuation (a ";" between
    // clauses) is untouched.
    .replace(/^[\s,;:!?*."'·\-–—]+/, "")
    .replace(/[\s,;:!?*"'·\-–—]+$/, "")
    .trim();
  return t.length > 0 ? t : null;
}
