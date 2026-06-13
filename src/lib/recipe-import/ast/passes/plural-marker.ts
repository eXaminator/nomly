import type { Leaf } from "../render-notes";

/**
 * Annotate inline pluralization markers a word carries — "Tomate(n)", "Ei(er)",
 * "Dose/n", "Zweig/e", "Pita-Brot(e)" — WITHOUT rewriting the source. Both the
 * marker PUNCTUATION ("(", ")", "/") AND the suffix letters get role
 * "plural-marker": both are dropped from the DISPLAYED name and the notes (so
 * the base word shows — "Tomate(n)" → "Tomate"). For MATCHING the punctuation
 * is skipped while the suffix WORD glues onto the base ("Ei(er)" → looks up
 * "Eier", "Dose/n" → unit "Dosen"). The "/()" are simply IGNORED for matching;
 * we don't validate the suffix, so any glued marker works.
 *
 * A space breaks the sequence: "Brot (alt)" is NOT a marker (the "(" doesn't
 * abut "Brot"), so it stays a normal parenthetical. Mutates `leaves`.
 */
// A plural ENDING is one of a small, closed grammatical set (DE + EN) — NOT any
// lowercase word. A capitalized suffix ("Dose/Glas") or a full word
// ("kleine/mittlere", "frisch/getrocknet") is a separate word — an alternative
// or descriptor, not a plural marker — and must stay verbatim in the note.
const PLURAL_ENDINGS = new Set([
  "n", "en", "e", "er", "s", "es", "se", "ses", "nen", "innen",
]);
const isPluralEnding = (w: string): boolean => PLURAL_ENDINGS.has(w.toLowerCase());

export function applyPluralMarkers(leaves: Leaf[]): void {
  for (let i = 0; i < leaves.length; i++) {
    const lf = leaves[i];
    const prev = leaves[i - 1];
    // Must directly follow a word (no whitespace): "Tomate(n)", "Dose/n".
    if (!prev || prev.kind !== "word" || lf.start !== prev.end) continue;

    // "(letters)" form: open, inner letters, close — all adjacent.
    if (lf.kind === "open" && !lf.bracket) {
      const inner = leaves[i + 1];
      const close = leaves[i + 2];
      if (
        inner?.kind === "word" &&
        isPluralEnding(inner.text) &&
        inner.start === lf.end &&
        close?.kind === "close" &&
        close.start === inner.end
      ) {
        lf.role = "plural-marker";
        close.role = "plural-marker";
        inner.role = "plural-marker";
        // Promote the suffix out of the paren nesting so it reads as part of the
        // base word (depth-0), not parenthetical content.
        inner.depth = prev.depth;
        i += 2;
      }
      continue;
    }
    // "/letters" form: slash, suffix letters — adjacent.
    if (lf.kind === "slash") {
      const inner = leaves[i + 1];
      if (inner?.kind === "word" && isPluralEnding(inner.text) && inner.start === lf.end) {
        lf.role = "plural-marker";
        inner.role = "plural-marker";
        inner.depth = prev.depth;
        i += 1;
      }
    }
  }
}
