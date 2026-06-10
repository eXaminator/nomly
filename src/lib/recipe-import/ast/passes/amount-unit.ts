import { consumeQuantity } from "../numeric";
import type { Leaf } from "../render-notes";
import { consumeGroup, groupByWhitespace, type Group } from "../tokens";

const TEXT_ONE = new Set(["ein", "eine", "einen", "einem", "einer", "eins", "a", "an"]);
const TEXT_HALF = new Set(["halber", "halbe", "halbes", "halben", "half"]);
const TEXT_QUARTER = new Set(["viertel", "quarter"]);

/** Size words that may sit between the quantity and the unit ("1 small bunch",
 *  "1 kl. Dose"). They are SKIPPED so the unit is still found, but NOT consumed
 *  — they stay verbatim in the note. */
export const SIZE_MODIFIERS = new Set([
  "small", "large", "medium", "big", "jumbo", "tiny", "huge",
  "klein", "kleine", "kleiner", "kleines", "kleinen", "kl",
  "gross", "groß", "große", "großer", "großes", "großen", "grosse",
  "mittel", "mittlere", "mittlerer", "mittelgroß", "mittelgross",
  "heaped", "heaping", "level", "gehäuft", "gestrichen", "gestrichener",
  "gestrichene", "geh",
]);

const norm = (s: string): string => s.toLowerCase().replace(/[.,]+$/, "");

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
  const rawGroups = groupByWhitespace(source, leaves);
  // Merge a spaced German decimal across the gap ("0," + "5" → "0,5") in place —
  // no source rewrite, the merged group keeps both groups' leaves and offsets.
  const groups: Group[] = [];
  for (const g of rawGroups) {
    const last = groups[groups.length - 1];
    if (last && /\d[.,]$/.test(last.text) && /^\d/.test(g.text)) {
      last.text += g.text;
      last.leaves.push(...g.leaves);
      last.end = g.end;
    } else {
      groups.push({ ...g, leaves: [...g.leaves] });
    }
  }
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

  const isUnit = (g: Group): boolean =>
    knownUnitTokens.has(g.text.toLowerCase()) || knownUnitTokens.has(norm(g.text));
  // A size compound like "12-count" / "28-ounce" — a number dashed to a word.
  const isSizeCompound = (g: Group): boolean => /^\d+[-–]\p{L}+\.?$/u.test(g.text);
  // A group that is part of a parenthetical ("(28", "oz.)") — skip it when
  // hunting for the unit so "(28 oz.) can" still finds "can".
  const isParenGroup = (g: Group): boolean =>
    g.leaves.some((l) => l.depth > 0 || l.kind === "open" || l.kind === "close");

  let unitName: string | null = null;
  // Skip size modifiers / size compounds / parenthetical groups between the
  // quantity and the unit ("1 small bunch", "1 12-count package",
  // "1 (28 oz.) can") — they're not consumed (they stay in the note), but they
  // mustn't hide the unit behind them.
  let probe = cur;
  while (
    probe < groups.length &&
    !isUnit(groups[probe]) &&
    (SIZE_MODIFIERS.has(norm(groups[probe].text)) ||
      isSizeCompound(groups[probe]) ||
      isParenGroup(groups[probe]))
  ) {
    probe += 1;
  }
  if (probe < groups.length && isUnit(groups[probe])) {
    consumeGroup(groups[probe], "unit");
    unitName = groups[probe].text.replace(/\.$/, "");
    if (quantity === null) quantity = 1;
    cur = probe + 1;
  } else {
    // Trailing-unit fallback: "1 garlic clove" — the unit follows the name. Only
    // fire when the name region (up to the first comma/paren) has no interior
    // number (guards "1-inch pieces") and the LAST token is a known unit with a
    // name in front of it.
    const region: Group[] = [];
    for (let k = cur; k < groups.length; k++) {
      const g = groups[k];
      if (g.leaves.some((l) => l.depth === 0 && (l.kind === "comma" || l.kind === "open"))) break;
      region.push(g);
    }
    const hasNumber = region.some((g) => g.leaves.some((l) => l.kind === "number"));
    const last = region[region.length - 1];
    if (!hasNumber && region.length >= 2 && last && isUnit(last)) {
      consumeGroup(last, "unit");
      unitName = last.text.replace(/\.$/, "");
      if (quantity === null) quantity = 1;
    }
  }

  return { quantity, unitName, rangeExpression };
}
