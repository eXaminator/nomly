import type { Leaf } from "../render-notes";
import { applyAmountUnit, type AmountUnit } from "./amount-unit";

/**
 * Handle the inverted "Name: qty unit" colon-amount form ("Mehl: 500 g")
 * WITHOUT rewriting the source: when a depth-0 ":" is followed by an amount and
 * preceded by a name, run the amount/unit extraction on the after-colon leaves
 * (marking them in place) and drop the colon. The before-colon leaves stay for
 * the matcher. Returns the extracted amount/unit, or null when the line isn't
 * this form (the caller then runs the normal leading-amount pass). Mutates
 * `leaves`.
 */
export function applyColonAmount(
  source: string,
  leaves: Leaf[],
  knownUnitTokens: ReadonlySet<string>,
): AmountUnit | null {
  const colonIdx = leaves.findIndex(
    (l) => l.depth === 0 && l.kind === "punct" && l.text === ":",
  );
  if (colonIdx < 0) return null;

  const after = leaves.slice(colonIdx + 1).filter((l) => l.depth === 0);
  // The part after the colon must lead with a number (an amount), and there
  // must be a name before it.
  if (after.length === 0 || after[0].kind !== "number") return null;
  const before = leaves
    .slice(0, colonIdx)
    .filter((l) => l.depth === 0 && (l.kind === "word" || l.kind === "number"));
  if (before.length === 0) return null;

  const res = applyAmountUnit(source, leaves.slice(colonIdx + 1), knownUnitTokens);
  if (res.quantity === null && res.unitName === null) return null;

  leaves[colonIdx].consumed = true;
  leaves[colonIdx].role = "connector";
  return res;
}
