import { consumeQuantity, parseSingleNumericToken, formatRangeNumber, round3 } from "../numeric";
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
    const decimalGlue = last != null && /\d[.,]$/.test(last.text) && /^\d/.test(g.text);
    // A size compound spelled with a space after the dash ("15- ounce") — fuse
    // it into one "15-ounce" group so it reads as a size note, not as part of a
    // mixed-number amount ("1 15-" → 16). Offsets stay faithful for the notes.
    const spacedSizeCompound =
      last != null && /^\d+[-–]$/.test(last.text) && /^\p{L}+\.?$/u.test(g.text);
    if (decimalGlue || spacedSizeCompound) {
      last!.text += g.text;
      last!.leaves.push(...g.leaves);
      last!.end = g.end;
    } else {
      groups.push({ ...g, leaves: [...g.leaves] });
    }
  }
  // Skip leading groups already consumed (e.g. an "opt." marker), leading size
  // modifiers ("Heaping 1 tsp" — stay in notes), and drop a leading remainder
  // connector ("plus 1 tsp", "to ½ tsp").
  let cur = 0;
  while (cur < groups.length) {
    if (groups[cur].leaves.every((l) => l.consumed)) {
      cur += 1;
      continue;
    }
    const k = norm(groups[cur].text);
    if (k === "plus" || k === "to") {
      consumeGroup(groups[cur], "connector");
      cur += 1;
      continue;
    }
    if (SIZE_MODIFIERS.has(k)) {
      cur += 1; // skip (left in the notes), not consumed
      continue;
    }
    break;
  }

  let quantity: number | null = null;
  let rangeExpression: string | null = null;
  let unitName: string | null = null;

  const isUnit = (g: Group): boolean =>
    knownUnitTokens.has(g.text.toLowerCase()) || knownUnitTokens.has(norm(g.text));
  // A size compound like "12-count" / "28-ounce" / "4-inch" — a number dashed to
  // a word.
  const isSizeCompound = (g: Group): boolean => /^\d+[-–]\p{L}+\.?$/u.test(g.text);
  // A group that is part of a parenthetical ("(28", "oz.)") — skip it when
  // hunting for the unit so "(28 oz.) can" still finds "can".
  const isParenGroup = (g: Group): boolean =>
    g.leaves.some((l) => l.depth > 0 || l.kind === "open" || l.kind === "close");

  // A range that repeats its unit on both sides ("25 g – 50 g", "1 cup - 2
  // cups", "¼ tsp to ½ tsp"): number unit <connector> number [unit]. The
  // numeric run can't span the interleaved unit, so detect the shape here and
  // collapse it to a range. The connector is a dash group or a "to"/"bis" word.
  const isRangeConnector = (g: Group | undefined): boolean =>
    g != null &&
    ((g.leaves.length === 1 && g.leaves[0].kind === "dash") ||
      norm(g.text) === "to" ||
      norm(g.text) === "bis");
  if (cur + 3 < groups.length && quantity === null && !isSizeCompound(groups[cur])) {
    const g0 = groups[cur];
    const g1 = groups[cur + 1];
    const g2 = groups[cur + 2];
    const g3 = groups[cur + 3];
    const g4 = groups[cur + 4];
    const n1 = g0 ? parseSingleNumericToken(g0.text) : null;
    const n2 = g3 ? parseSingleNumericToken(g3.text) : null;
    if (
      n1 != null &&
      n2 != null &&
      g1 != null &&
      isUnit(g1) &&
      isRangeConnector(g2) &&
      ((g1.start === 0 || /\s/.test(source[g1.start - 1] ?? " ")))
    ) {
      const sameUnitTail = g4 != null && isUnit(g4) && norm(g4.text) === norm(g1.text);
      quantity = round3(Math.max(n1, n2));
      rangeExpression = `${formatRangeNumber(n1)}-${formatRangeNumber(n2)}`;
      unitName = g1.text.replace(/\.$/, "");
      consumeGroup(g0, "amount");
      consumeGroup(g1, "unit");
      consumeGroup(g2, "connector");
      consumeGroup(g3, "amount");
      if (sameUnitTail) consumeGroup(g4!, "unit");
      cur += sameUnitTail ? 5 : 4;
    }
  }

  // A LEADING size compound with no amount yet ("4-inch stems"). If the word
  // part is itself a unit AND no other unit follows (no container like
  // "12-count package" / "1 (28-ounce) can"), the compound IS the amount+unit:
  // "4-inch" → 4 + inch. Otherwise it stays a size note and the probe below
  // finds the real (container) unit.
  if (cur < groups.length && quantity === null && isSizeCompound(groups[cur])) {
    const g = groups[cur];
    const numLeaf = g.leaves.find((l) => l.kind === "number");
    const wordLeaf = g.leaves.find((l) => l.kind === "word");
    const wordIsUnit =
      wordLeaf != null &&
      (knownUnitTokens.has(wordLeaf.text.toLowerCase()) ||
        knownUnitTokens.has(norm(wordLeaf.text)));
    const unitAhead = groups.slice(cur + 1).some((other) => isUnit(other));
    if (numLeaf && wordLeaf && wordIsUnit && !unitAhead) {
      const n = parseSingleNumericToken(numLeaf.text);
      if (n != null) {
        quantity = n;
        for (const l of g.leaves) {
          l.consumed = true;
          l.role = l.kind === "number" ? "amount" : l.kind === "word" ? "unit" : "connector";
        }
        unitName = wordLeaf.text.replace(/\.$/, "");
        cur += 1;
      }
    }
  }

  const ARTICLES = new Set(["a", "an", "ein", "eine", "einen", "einem", "einer", "eins"]);
  const dropArticle = () => {
    if (cur < groups.length && ARTICLES.has(wordKey(groups[cur]))) {
      consumeGroup(groups[cur], "amount");
      cur += 1;
    }
  };

  if (cur < groups.length) {
    const w = wordKey(groups[cur]);
    const next = cur + 1 < groups.length ? wordKey(groups[cur + 1]) : "";
    if (TEXT_ONE.has(w) && TEXT_HALF.has(next)) {
      // "eine halbe Tasse" → 0.5
      quantity = 0.5;
      consumeGroup(groups[cur], "amount");
      consumeGroup(groups[cur + 1], "amount");
      cur += 2;
    } else if (TEXT_ONE.has(w) && TEXT_QUARTER.has(next)) {
      quantity = 0.25;
      consumeGroup(groups[cur], "amount");
      consumeGroup(groups[cur + 1], "amount");
      cur += 2;
    } else if (TEXT_ONE.has(w)) {
      quantity = 1;
      consumeGroup(groups[cur], "amount");
      cur += 1;
    } else if (TEXT_HALF.has(w)) {
      quantity = 0.5;
      consumeGroup(groups[cur], "amount");
      cur += 1;
      dropArticle(); // "half a teaspoon" → drop "a"
    } else if (TEXT_QUARTER.has(w)) {
      quantity = 0.25;
      consumeGroup(groups[cur], "amount");
      cur += 1;
      dropArticle();
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
