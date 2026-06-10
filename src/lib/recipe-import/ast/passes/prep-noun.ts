import type { Leaf } from "../render-notes";

/** Prep nouns whose object is the real ingredient: "Saft einer Zitrone" (juice
 *  OF a lemon), "Schale von 2 Orangen", "Juice of 1 lemon". The noun moves to
 *  the notes and the connecting preposition is dropped, so the amount pass then
 *  sees the leading quantity. */
const PREP_NOUNS = new Set(["saft", "schale", "abrieb", "juice", "peel", "rind", "zest"]);
/** Pure connectors that follow a prep noun and are dropped entirely. */
const PREP_CONNECTORS = new Set(["of", "von", "vom"]);

const norm = (s: string): string => s.toLowerCase().replace(/[.,:]+$/, "");

/**
 * If the segment leads with a prep noun + connector ("Juice of", "Saft von"),
 * consume both and return the prep-noun text to prepend to the notes. The
 * connector is consumed (dropped); the prep noun is consumed too but its text
 * is returned so the caller can re-add it as a leading note fragment.
 * Mutates `leaves`. Returns null when no prep-noun phrase leads.
 */
export function applyPrepNoun(leaves: Leaf[]): string | null {
  const words = leaves.filter((l) => l.depth === 0 && !l.consumed);
  if (words.length < 2) return null;
  const first = words[0];
  const second = words[1];
  if (first.kind !== "word" || !PREP_NOUNS.has(norm(first.text))) return null;
  if (second.kind !== "word" || !PREP_CONNECTORS.has(norm(second.text))) return null;
  const note = first.text;
  first.consumed = true;
  first.role = "prep-noun";
  second.consumed = true;
  second.role = "connector";
  return note;
}
