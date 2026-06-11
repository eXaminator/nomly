import type { Leaf } from "../render-notes";

/** Prep nouns whose object is the real ingredient: "Saft einer Zitrone" (juice
 *  OF a lemon), "Schale von 2 Orangen", "Juice of 1 lemon". The noun moves to
 *  the notes and the connecting preposition is dropped, so the amount pass then
 *  sees the leading quantity. */
const PREP_NOUNS = new Set(["saft", "schale", "abrieb", "juice", "peel", "rind", "zest"]);
/** Pure connectors that follow a prep noun and are dropped entirely. */
const PREP_CONNECTORS = new Set(["of", "von", "vom"]);
/** Articles/quantities that may follow a prep noun ("Saft EINER Zitrone") —
 *  the prep noun still applies, but these belong to the amount pass, so the
 *  prep noun consumes itself (+ any connector) and leaves them. */
const PREP_FOLLOWERS = new Set([
  "of", "von", "vom", "a", "an", "ein", "eine", "einen", "einem", "einer", "eins",
]);

const norm = (s: string): string => s.toLowerCase().replace(/[.,:]+$/, "");

/**
 * If the segment leads with a prep noun whose object is the real ingredient
 * ("Juice of 1 lemon", "Saft einer Zitrone", "Schale von 2 Orangen"), consume
 * the prep noun (and a directly-following pure connector "of"/"von"), and
 * return the prep-noun text to prepend to the notes. Any article/number is left
 * for the amount pass. Mutates `leaves`. Returns null when no prep-noun phrase
 * leads or it isn't followed by a connector / article / number.
 */
export function applyPrepNoun(leaves: Leaf[]): string | null {
  const words = leaves.filter((l) => l.depth === 0 && !l.consumed);
  if (words.length < 2) return null;
  const first = words[0];
  const second = words[1];
  if (first.kind !== "word" || !PREP_NOUNS.has(norm(first.text))) return null;
  // The prep noun applies only when what follows is its object: a connector, an
  // article, or a number ("Saft einer …", "Juice of …", "Saft 2 Zitronen").
  const followsObject =
    (second.kind === "word" && PREP_FOLLOWERS.has(norm(second.text))) ||
    second.kind === "number";
  if (!followsObject) return null;
  const note = first.text;
  first.consumed = true;
  first.role = "prep-noun";
  // Drop only a pure preposition; leave an article/number for the amount pass.
  if (second.kind === "word" && PREP_CONNECTORS.has(norm(second.text))) {
    second.consumed = true;
    second.role = "connector";
  }
  return note;
}
