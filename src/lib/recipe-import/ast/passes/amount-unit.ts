import { consumeQuantity, parseSingleNumericToken, formatRangeNumber, round3 } from "../numeric";
import type { Leaf } from "../render-notes";
import { consumeGroup, groupByWhitespace, type Group } from "../tokens";
import { matchQuantifierAt } from "./quantifier";
import type { QuantifierLookup } from "../../index";

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

/** A minimal article set kept ONLY for the "drop a bare article sitting AFTER a
 *  fraction" tidy ("half a teaspoon" / "halber a …" → drop the "a"). This is a
 *  SYNTAX rule, not a number-word value — recognition of standalone number-words
 *  (ein/eine/a/zwei/half/…) now lives in the DB-driven quantifier table. */
const ARTICLES = new Set(["a", "an", "ein", "eine", "einen", "einem", "einer", "eins"]);

/** Connectors that link the unit to the ingredient ("Pinch of …", "Dose von …").
 *  Consumed onto the unit so they never reach the notes. */
const POST_UNIT_CONNECTORS = new Set(["of", "von", "vom"]);

export type AmountUnit = {
  quantity: number | null;
  unitName: string | null;
  /** Original "lo-hi" expression when the amount was a range, else null. */
  rangeExpression: string | null;
  /** Low bound of a true lo–hi range, else null. High bound is `quantity`. */
  quantityLow: number | null;
  /** id of a leading quantifier word that claimed the amount slot, else null. */
  quantifierId: number | null;
  /** Canonical name of the claiming quantifier, else null. */
  quantifierName: string | null;
};

export type UnspecificOpts = {
  /** Lowercased tokens of units that take no amount ("etwas", "a sprinkle"). */
  unspecificTokens?: ReadonlySet<string>;
  /** Max unit-name token width to probe (default 1 = single-token only). */
  maxUnitTokens?: number;
  /** Configurable amount-words ("einige", "zwei", "ein"). When present, a
   *  leading quantifier may claim the amount slot per the unit-first rule. */
  quantifiers?: QuantifierLookup;
};

const wordKey = (g: Group): string => g.text.toLowerCase().replace(/[.,]$/, "");

/**
 * Consume the leading amount + unit of a segment, marking the claimed leaves.
 * Handles numeric runs/ranges (via {@link consumeQuantity}) and leading
 * word-form quantifiers (ein/eine/a → 1, halber → 0.5, viertel → 0.25, written
 * cardinals → 2..12, …) via the DB-driven quantifier table in `opts.quantifiers`
 * — see {@link matchQuantifierAt}. A bare unit with no quantity implies quantity
 * 1. Mutates `leaves`.
 */
export function applyAmountUnit(
  source: string,
  leaves: Leaf[],
  knownUnitTokens: ReadonlySet<string>,
  opts: UnspecificOpts = {},
): AmountUnit {
  const unspecificTokens = opts.unspecificTokens ?? new Set<string>();
  const maxUnitTokens = Math.max(1, opts.maxUnitTokens ?? 1);
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
  let quantityLow: number | null = null;
  let unitName: string | null = null;
  let quantifierId: number | null = null;
  let quantifierName: string | null = null;
  // A claiming quantifier owns the amount slot — even when its value is null —
  // so the unit probe below must NOT default a following unit's quantity to 1.
  let quantifierWon = false;

  const isUnit = (g: Group): boolean =>
    knownUnitTokens.has(g.text.toLowerCase()) || knownUnitTokens.has(norm(g.text));
  // A size compound like "12-count" / "28-ounce" / "4-inch" / "15.5-ounce" — a
  // number (possibly decimal) dashed to a word.
  const isSizeCompound = (g: Group): boolean =>
    /^\d+(?:[.,]\d+)?[-–]\p{L}+\.?$/u.test(g.text);
  // A group that is part of a parenthetical ("(28", "oz.)") — skip it when
  // hunting for the unit so "(28 oz.) can" still finds "can".
  const isParenGroup = (g: Group): boolean =>
    g.leaves.some((l) => l.depth > 0 || l.kind === "open" || l.kind === "close");

  const isUnspecificName = (name: string): boolean => {
    const l = name.toLowerCase();
    return unspecificTokens.has(l) || unspecificTokens.has(norm(l));
  };
  // Longest contiguous unit window at index i: join group texts with single
  // spaces and probe the known-unit set from maxUnitTokens down to 1. STRICT —
  // exact joined-token equality only (no fuzzy/prefix/gaps). Skips windows that
  // include an already-consumed group. Returns the matched length + display
  // name, or null. With maxUnitTokens === 1 this reduces to the single-token
  // `isUnit` check.
  const matchUnitAt = (i: number): { len: number; name: string } | null => {
    const maxLen = Math.min(maxUnitTokens, groups.length - i);
    for (let len = maxLen; len >= 1; len--) {
      const win = groups.slice(i, i + len);
      if (win.some((g) => g.leaves.every((l) => l.consumed))) continue;
      const raw = win.map((g) => g.text).join(" ");
      const lower = raw.toLowerCase();
      if (knownUnitTokens.has(lower) || knownUnitTokens.has(norm(lower))) {
        return { len, name: raw.replace(/\.$/, "") };
      }
    }
    return null;
  };
  const consumeUnitWindow = (i: number, len: number) => {
    for (let k = 0; k < len; k++) consumeGroup(groups[i + k], "unit");
  };

  // Configurable quantifier ("einige Stiele", "zwei Äpfel", "a pinch"): a
  // LEADING amount-word claims the amount slot UNLESS doing so would strip the
  // segment of its only unit. The resolution rule:
  //  - the quantifier wins if it isn't a unit at all, OR it is a unit but
  //    ANOTHER unit token follows it (to serve as the real unit);
  //  - if it's the only unit (nothing else follows), it stays a unit — handled
  //    by the unspecific/normal unit logic below (quantifier NOT set).
  // When it wins: quantity = entry.value (may be null — do NOT default a
  // following unit's quantity to 1), and the row records the quantifier id/name.
  if (opts.quantifiers) {
    const q = matchQuantifierAt(groups, cur, opts.quantifiers);
    if (q) {
      const window = groups.slice(cur, cur + q.len);
      const windowText = window.map((g) => g.text).join(" ");
      const windowIsUnit =
        knownUnitTokens.has(windowText.toLowerCase()) ||
        knownUnitTokens.has(norm(windowText));
      const unitFollows = groups
        .slice(cur + q.len)
        .some((g) => g.leaves.every((l) => !l.consumed) && isUnit(g));
      if (!windowIsUnit || unitFollows) {
        for (let k = 0; k < q.len; k++) consumeGroup(groups[cur + k], "amount");
        cur += q.len;
        quantity = q.entry.value;
        quantifierId = q.entry.id;
        quantifierName = q.entry.name;
        quantifierWon = true;
        // Drop a bare article sitting AFTER a fraction word ("half a teaspoon"
        // → drop "a"; "juice of half a lemon" → 0.5 lemon). This is a syntax
        // tidy on the leftover article, not a number-word value.
        if (
          q.entry.value != null &&
          q.entry.value < 1 &&
          cur < groups.length &&
          ARTICLES.has(wordKey(groups[cur]))
        ) {
          consumeGroup(groups[cur], "amount");
          cur += 1;
        }
      }
    }
  }

  // Unspecific units ("etwas", "a sprinkle", "ein Schuss") take NO amount. If
  // the segment leads with one — including a multi-word alias whose first word
  // is an article ("a sprinkle") — claim it as the unit with a null quantity
  // and stop. The "2 etwas" shape (number first) is handled by the main probe.
  {
    const m = matchUnitAt(cur);
    if (m && isUnspecificName(m.name)) {
      consumeUnitWindow(cur, m.len);
      cur += m.len;
      if (cur < groups.length && POST_UNIT_CONNECTORS.has(norm(groups[cur].text))) {
        consumeGroup(groups[cur], "unit");
        cur += 1;
      }
      return {
        quantity: null,
        unitName: m.name,
        rangeExpression: null,
        quantityLow: null,
        quantifierId,
        quantifierName,
      };
    }
  }

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
      quantityLow = round3(Math.min(n1, n2));
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

  // Numeric amount syntax (digits / fractions / ranges / decimals — "2",
  // "1/2", "0,5", "2-3", "1 1/2", "½"). Word-form quantifiers were already
  // claimed above via the quantifier table, so skip this once one has won.
  if (cur < groups.length && quantity === null && !quantifierWon) {
    const work = groups.slice(cur).map((g) => g.text);
    const before = work.length;
    const r = consumeQuantity(work);
    if (r) {
      quantity = r.quantity;
      rangeExpression = r.rangeExpression;
      quantityLow = r.quantityLow;
      const n = before - work.length;
      for (let k = 0; k < n; k++) consumeGroup(groups[cur + k], "amount");
      cur += n;
    }
  }

  // Skip size modifiers / size compounds / parenthetical groups between the
  // quantity and the unit ("1 small bunch", "1 12-count package",
  // "1 (28 oz.) can") — they're not consumed (they stay in the note), but they
  // mustn't hide the unit behind them.
  let probe = cur;
  while (
    probe < groups.length &&
    !matchUnitAt(probe) &&
    (SIZE_MODIFIERS.has(norm(groups[probe].text)) ||
      isSizeCompound(groups[probe]) ||
      isParenGroup(groups[probe]))
  ) {
    probe += 1;
  }
  const probed = probe < groups.length ? matchUnitAt(probe) : null;
  if (probed) {
    consumeUnitWindow(probe, probed.len);
    unitName = probed.name;
    if (isUnspecificName(probed.name)) {
      // Unspecific unit: drop any number parsed in front ("2 etwas" → null).
      quantity = null;
    } else if (quantity === null && !quantifierWon) {
      // A claiming quantifier already owns the slot — its (possibly null) value
      // stands; only a bare unit with no amount-word in front implies 1.
      quantity = 1;
    }
    cur = probe + probed.len;
    // A connector right after the unit ("Pinch OF …", "1 can OF …") links the
    // unit to the ingredient and is meaningless on its own — attach it to the
    // unit (highlighted with it, kept out of the notes), regardless of what
    // follows (a leading prep word like "crushed" must not hide it).
    if (cur < groups.length && POST_UNIT_CONNECTORS.has(norm(groups[cur].text))) {
      consumeGroup(groups[cur], "unit");
      cur += 1;
    }
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
      if (isUnspecificName(unitName)) quantity = null;
      else if (quantity === null && !quantifierWon) quantity = 1;
    }
  }

  return { quantity, unitName, rangeExpression, quantityLow, quantifierId, quantifierName };
}
