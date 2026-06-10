import { consumeQuantity } from "../numeric";
import type { Leaf } from "../render-notes";
import { consumeGroup, groupByWhitespace, type Group } from "../tokens";

const TEXT_ONE = new Set(["ein", "eine", "einen", "einem", "einer", "eins", "a", "an"]);
const TEXT_HALF = new Set(["halber", "halbe", "halbes", "halben", "half"]);
const TEXT_QUARTER = new Set(["viertel", "quarter"]);

export type AmountUnit = {
  quantity: number | null;
  unitName: string | null;
  /** Original "lo-hi" expression when the amount was a range, else null. */
  rangeExpression: string | null;
};

const wordKey = (g: Group): string => g.text.toLowerCase().replace(/[.,]$/, "");

/**
 * Consume the leading amount + unit of a segment, marking the claimed leaves.
 * Handles numeric runs/ranges (via {@link consumeQuantity}) and the common
 * text amounts (ein/eine/a → 1, halber → 0.5, viertel → 0.25). A bare unit with
 * no quantity implies quantity 1. Mutates `leaves`.
 */
export function applyAmountUnit(
  source: string,
  leaves: Leaf[],
  knownUnitTokens: ReadonlySet<string>,
): AmountUnit {
  const groups = groupByWhitespace(source, leaves);
  // Skip leading groups already consumed (e.g. an "opt." marker).
  let cur = 0;
  while (cur < groups.length && groups[cur].leaves.every((l) => l.consumed)) cur += 1;

  let quantity: number | null = null;
  let rangeExpression: string | null = null;

  if (cur < groups.length) {
    const w = wordKey(groups[cur]);
    if (TEXT_ONE.has(w)) {
      quantity = 1;
      consumeGroup(groups[cur], "amount");
      cur += 1;
    } else if (TEXT_HALF.has(w)) {
      quantity = 0.5;
      consumeGroup(groups[cur], "amount");
      cur += 1;
    } else if (TEXT_QUARTER.has(w)) {
      quantity = 0.25;
      consumeGroup(groups[cur], "amount");
      cur += 1;
    } else {
      const work = groups.slice(cur).map((g) => g.text);
      const before = work.length;
      const r = consumeQuantity(work);
      if (r) {
        quantity = r.quantity;
        rangeExpression = r.rangeExpression;
        const n = before - work.length;
        for (let k = 0; k < n; k++) consumeGroup(groups[cur + k], "amount");
        cur += n;
      }
    }
  }

  let unitName: string | null = null;
  if (cur < groups.length) {
    const g = groups[cur];
    const lower = g.text.toLowerCase();
    if (knownUnitTokens.has(lower) || knownUnitTokens.has(lower.replace(/\.$/, ""))) {
      consumeGroup(g, "unit");
      unitName = g.text.replace(/\.$/, "");
      if (quantity === null) quantity = 1;
    }
  }

  return { quantity, unitName, rangeExpression };
}
