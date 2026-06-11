import type { Leaf } from "../render-notes";

/**
 * Single-word optional markers. Consuming them sets `isOptional` AND removes
 * them from the note. `nach Belieben` / `to taste` are deliberately NOT here —
 * they stay verbatim in the note and never flip the flag.
 */
const OPTIONAL_WORDS = new Set([
  "optional",
  "optionally",
  "opt",
  "evtl",
  "eventuell",
  "ggf",
  "fakultativ",
]);

/** Two-word optional markers. "bei Bedarf" / "nach Bedarf" are deliberately NOT
 *  here — like "nach Belieben" they stay verbatim in the note and never flip the
 *  flag. */
const OPTIONAL_PAIRS = new Set([
  "wenn vorhanden",
  "if available",
  "if needed",
]);

const norm = (s: string): string => s.toLowerCase().replace(/[.,:]+$/, "");

/**
 * Mark optional-marker tokens consumed and report whether the row is optional.
 * Mutates `leaves`.
 */
export function applyOptional(leaves: Leaf[]): boolean {
  let isOptional = false;

  for (let i = 0; i + 1 < leaves.length; i++) {
    const a = leaves[i];
    const b = leaves[i + 1];
    if (a.kind !== "word" || b.kind !== "word") continue;
    if (a.consumed || b.consumed) continue;
    if (OPTIONAL_PAIRS.has(`${a.text.toLowerCase()} ${norm(b.text)}`)) {
      a.consumed = b.consumed = true;
      a.role = b.role = "optional-marker";
      isOptional = true;
    }
  }

  // "n. B." (nach Belieben abbreviation) → optional. Spelled-out "nach
  // Belieben" stays a note (handled elsewhere); only the abbreviation flips it.
  for (let i = 0; i + 1 < leaves.length; i++) {
    const a = leaves[i];
    if (a.kind !== "word" || a.consumed || a.text.toLowerCase() !== "n") continue;
    let j = i + 1;
    if (leaves[j]?.kind === "punct" && leaves[j].text === ".") j += 1;
    const b = leaves[j];
    if (b && b.kind === "word" && b.text.toLowerCase() === "b") {
      isOptional = true;
      for (let k = i; k <= j; k++) {
        leaves[k].consumed = true;
        leaves[k].role = "optional-marker";
      }
      if (leaves[j + 1]?.kind === "punct" && leaves[j + 1].text === "." && leaves[j + 1].start === b.end) {
        leaves[j + 1].consumed = true;
        leaves[j + 1].role = "optional-marker";
      }
    }
  }

  for (let i = 0; i < leaves.length; i++) {
    const lf = leaves[i];
    if (lf.kind !== "word" || lf.consumed) continue;
    if (OPTIONAL_WORDS.has(norm(lf.text))) {
      lf.consumed = true;
      lf.role = "optional-marker";
      isOptional = true;
      // Swallow punctuation glued to the marker ("opt.", "optional:",
      // "optional,") so the whole token disappears from the note.
      const nx = leaves[i + 1];
      if (
        nx &&
        (nx.kind === "punct" || nx.kind === "comma" || nx.kind === "semicolon") &&
        nx.start === lf.end
      ) {
        nx.consumed = true;
        nx.role = "optional-marker";
      }
    }
  }

  return isOptional;
}
