import type { Leaf } from "../render-notes";

const PLURAL_SUFFIXES = new Set(["n", "en", "s", "nen", "innen"]);

/**
 * Mark inline pluralization markers a word carries — "Tomate(n)", "Dose/n" —
 * as dropped, WITHOUT rewriting the source. The marker leaves are consumed
 * (role "connector") so they leave the match input and the notes and render as
 * "dropped" in highlights, while the leaves keep their original offsets.
 * Mutates `leaves`.
 */
export function applyPluralMarkers(leaves: Leaf[]): void {
  for (let i = 0; i < leaves.length; i++) {
    const lf = leaves[i];
    const prev = leaves[i - 1];
    // Must directly follow a word (no whitespace): "Tomate(n)", "Dose/n".
    if (!prev || prev.kind !== "word" || lf.start !== prev.end) continue;

    // "(n)" form: open, inner suffix word, close — all adjacent.
    if (lf.kind === "open" && !lf.bracket) {
      const inner = leaves[i + 1];
      const close = leaves[i + 2];
      if (
        inner?.kind === "word" &&
        PLURAL_SUFFIXES.has(inner.text.toLowerCase()) &&
        inner.start === lf.end &&
        close?.kind === "close" &&
        close.start === inner.end
      ) {
        for (const m of [lf, inner, close]) {
          m.consumed = true;
          m.role = "connector";
        }
        i += 2;
      }
      continue;
    }
    // "/n" form: slash, suffix word — adjacent.
    if (lf.kind === "slash") {
      const inner = leaves[i + 1];
      if (
        inner?.kind === "word" &&
        PLURAL_SUFFIXES.has(inner.text.toLowerCase()) &&
        inner.start === lf.end
      ) {
        for (const m of [lf, inner]) {
          m.consumed = true;
          m.role = "connector";
        }
        i += 1;
      }
    }
  }
}
