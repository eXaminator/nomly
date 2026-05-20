/**
 * Heuristic parser for an ingredient string of the form
 *   "500 g Hackfleisch, fein gewürfelt"
 * → { quantity: 500, unit: "g", name: "Hackfleisch", notes: "fein gewürfelt" }
 *
 * Designed for German recipe sources (Chefkoch, Lecker, …) but tolerates the
 * common English forms found in JSON-LD too. The unit string is returned
 * verbatim; the caller passes the controlled vocabulary (`knownUnitTokens`)
 * so adding a new alias to the DB automatically teaches the parser the new
 * token.
 */

const FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

export type ParsedIngredient = {
  quantity: number | null;
  unitName: string | null;
  name: string;
  notes: string | null;
};

/**
 * Text amount tokens that mean "one" — common in pasted recipes:
 * "Eine Prise Salz", "a pinch of nutmeg", "ein TL Honig".
 * Matched case-insensitively; the token IS consumed (the amount becomes 1).
 */
const TEXT_AMOUNT_ONE = new Set([
  "ein",
  "eine",
  "einen",
  "einem",
  "einer",
  "eins",
  "a",
  "an",
]);

/**
 * Approximate-quantity tokens that should be stripped before the numeric
 * matcher runs ("ca. 300 ml", "about 2 cups", "approximately 1 tbsp").
 */
const APPROX_TOKENS_RE = /^(ca\.?|etwa|about|approx\.?|approximately|roughly|ungefähr)$/i;

/**
 * Text amount tokens that mean "a small unspecified quantity". They produce
 * `quantity = null` and the matched word becomes part of the notes. Covers
 * "Etwas Salz", "some pepper", "a little bit of …".
 */
const TEXT_AMOUNT_VAGUE = new Set([
  "etwas",
  "some",
  "ein wenig",
  "a little",
  "a bit",
  "a touch",
]);

/**
 * Words that, when they appear standalone in the name area, mark the
 * boundary into "notes" — typically a list of alternatives or examples
 * ("Butter oder Margarine", "Salz z.B. Meersalz"). The matched word
 * itself is preserved in the notes so a reader still sees the relationship.
 */
const NOTE_BOUNDARY_TOKENS = new Set(
  [
    "or",
    "oder",
    "alternative",
    "alternativ",
    "bzw",
    "bzw.",
    "z.b.",
    "z.b",
    "zb",
    "ggf",
    "ggf.",
  ].map((t) => t.toLowerCase()),
);

/**
 * "Zum X" / "for X" suffix tokens — when the parser sees one of these
 * starting in the name area, everything from that point on is a note about
 * how the ingredient is used. Examples: "Puderzucker zum Bestreuen",
 * "olive oil for drizzling".
 */
const USAGE_PREFIX_TOKENS = new Set([
  "zum",
  "zur",
  "for",
  "fürs",
  "für",
]);

/**
 * Filler words to drop between a unit and the ingredient name —
 * "100g of caster sugar" → ignore "of"; same for German "100g von Zucker".
 * Also stripped from the very start of the input (before quantity parsing)
 * so leading conjunctions like "and Salt" / "und Pfeffer" don't pollute
 * the name.
 */
const NAME_FILLER_TOKENS = new Set([
  "of",
  "von",
  "vom",
  "and",
  "und",
  "the",
  "der",
  "die",
  "das",
]);

/**
 * Size modifiers that may sit between the quantity and the unit:
 * "1 kl. Dose Bohnen", "1 große Tasse Milch". We pull them out so the
 * unit-recogniser can see the bare unit ("Dose", "Tasse"), and append
 * the modifier to the notes so the reader keeps the size hint.
 *
 * Compared case-insensitively against the token with any trailing
 * period stripped — so both "kl." and "kl" match.
 */
const SIZE_MODIFIER_TOKENS = new Set([
  "kl",
  "kleine",
  "kleiner",
  "kleines",
  "klein",
  "gr",
  "große",
  "großer",
  "großes",
  "groß",
  "grosse",
  "grosser",
  "grosses",
  "gross",
  "mittl",
  "mittlere",
  "mittlerer",
  "mittleres",
  "mittel",
]);

/**
 * Fixed "to taste" / "nach Geschmack" phrases. When the parser sees one of
 * these anywhere in the input (case-insensitive), it removes the phrase
 * from the name and appends it to the notes.
 */
const TO_TASTE_PHRASES = [
  "nach geschmack",
  "zum abschmecken",
  "to taste",
];

/**
 * Tokens that, if they appear after a unit token, should still be treated
 * as "tail noise" not as part of the name — e.g. "12-count package" parses
 * "package" as the unit and "12-count" as the size hint via the leading
 * compound-token pre-processor.
 */
const SIZE_UNIT_TOKENS_RE = /^(count|ounce|ounces|oz|inch|inches|gram|grams|g|kg|ml|l|lb|pound|pounds)$/i;

const NUMERIC_TOKEN_RE = /^[\d./,\-–½¼¾⅓⅔⅛⅜⅝⅞]+$/;

function parseSingleNumericToken(t: string): number | null {
  const glyph = /^(\d+)?([½¼¾⅓⅔⅛⅜⅝⅞])$/.exec(t);
  if (glyph) {
    const whole = glyph[1] ? parseInt(glyph[1], 10) : 0;
    return whole + FRACTIONS[glyph[2]];
  }
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) {
    const den = parseInt(frac[2], 10);
    if (den <= 0) return null;
    return parseInt(frac[1], 10) / den;
  }
  const num = /^(\d+(?:[.,]\d+)?|[.,]\d+)$/.exec(t);
  if (num) return parseFloat(num[1].replace(",", "."));
  return null;
}

function evaluateNumericSequence(tokens: string[]): number | null {
  if (tokens.length === 0) return null;
  let total = 0;
  for (const t of tokens) {
    const v = parseSingleNumericToken(t);
    if (v === null) return null;
    total += v;
  }
  return total;
}

type RangeResult = {
  quantity: number;
  /** When the input was a range, the original expression (e.g. "1-2") for
   * inclusion in the notes. Null otherwise. */
  rangeExpression: string | null;
};

/**
 * Consume a quantity from the start of `tokens`. Returns the parsed number
 * (max value when the input is a range) and, when it was a range, the
 * original "lo-hi" expression for the notes.
 */
function consumeQuantity(tokens: string[]): RangeResult | null {
  if (tokens.length === 0) return null;
  // Strip "bis " ("up to") as a leading approximation: "bis 2 EL" → quantity 2,
  // range expr "bis 2".
  let bisPrefix = false;
  if (/^bis$/i.test(tokens[0])) {
    bisPrefix = true;
    tokens.shift();
  }
  if (tokens.length > 0 && APPROX_TOKENS_RE.test(tokens[0])) tokens.shift();
  if (tokens.length === 0) return null;

  // Collect numeric tokens, allowing "+" / "&" between them as additive
  // connectors ("2 + 1/4 cups" / "1 & ½ tsp"). The connectors are dropped;
  // the existing whitespace-implicit-add path then sums the numbers.
  const numericRun: string[] = [];
  while (tokens.length > 0) {
    if (NUMERIC_TOKEN_RE.test(tokens[0])) {
      numericRun.push(tokens.shift()!);
      continue;
    }
    if (
      (tokens[0] === "+" || tokens[0] === "&") &&
      numericRun.length > 0 &&
      tokens.length > 1 &&
      NUMERIC_TOKEN_RE.test(tokens[1])
    ) {
      tokens.shift();
      continue;
    }
    break;
  }
  if (numericRun.length === 0) return null;

  const expr = numericRun.join(" ");
  const parts = expr.split(/\s*[-–]\s*/).filter((p) => p.length > 0);
  if (parts.length === 0) return null;

  const values: number[] = [];
  for (const p of parts) {
    const v = evaluateNumericSequence(p.split(/\s+/).filter(Boolean));
    if (v !== null) values.push(v);
  }
  if (values.length === 0) return null;

  if (values.length === 1 && !bisPrefix) {
    return { quantity: round3(values[0]), rangeExpression: null };
  }
  // Range — take the max, keep the expression for the notes.
  const max = Math.max(...values);
  const rangeExpression = bisPrefix
    ? `bis ${formatRangeNumber(values[values.length - 1])}`
    : values.map(formatRangeNumber).join("-");
  return { quantity: round3(max), rangeExpression };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function formatRangeNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toString().replace(".", ",");
}

const EMOJI_LEAD_RE =
  /^(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{1F600}-\u{1F64F}]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF])\s*/u;

/**
 * Detect when a line is a section header rather than an ingredient. Returns
 * the cleaned header title, or null if the line should be parsed as an
 * ingredient. Heuristics (any of):
 *   - leading 2+ dashes (`"--- For the sauce ---"` → "For the sauce")
 *   - leading emoji
 *   - line ends with ":" ("Für den Teig:" → "Für den Teig")
 *   - line is all-caps (4+ letters), e.g. "FÜR DEN GRANATAPFELGUSS"
 */
export function detectSectionHeader(raw: string): string | null {
  let text = raw.trim();
  if (text.length === 0) return null;

  // Strip surrounding bracket-noise that often wraps section titles in pasted
  // recipes: "[Sauce]" → "Sauce".
  text = text.replace(/^\[|\]$/g, "").trim();

  if (/^[-–—]{2,}/.test(text) || /[-–—]{2,}$/.test(text)) {
    return text.replace(/^[-–—\s]+|[-–—\s]+$/g, "").trim() || null;
  }

  if (EMOJI_LEAD_RE.test(text)) {
    return text.replace(EMOJI_LEAD_RE, "").trim() || null;
  }

  if (/:\s*$/.test(text)) {
    return text.replace(/:\s*$/, "").trim() || null;
  }

  // All-caps detection: ≥4 letters, no lowercase letters at all. Tolerates
  // umlauts and basic punctuation.
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length >= 4 && letters.every((c) => c === c.toLocaleUpperCase("de"))) {
    return text.trim();
  }

  return null;
}

/**
 * Normalize a string for accent/diacritic-insensitive matching. Used by
 * downstream lookups so "Möhre" matches "Moehre" / "Mohre" / "möhre"
 * (after lower-casing).
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

/**
 * Pre-process the raw line: strip noise punctuation, brackets-as-notes,
 * to-taste phrases, and amount-at-end inversions.
 *
 * Returns the cleaned text plus any notes captured from the pre-processing.
 */
function preprocess(raw: string): { text: string; capturedNotes: string[] } {
  let text = raw;
  const capturedNotes: string[] = [];

  // Capture and strip [bracketed text] → notes.
  text = text.replace(/\[([^\]]+)\]/g, (_, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed.length > 0) capturedNotes.push(trimmed);
    return " ";
  });

  // Capture and strip case-insensitive "to taste" / "nach Geschmack" phrases.
  for (const phrase of TO_TASTE_PHRASES) {
    const re = new RegExp(
      `(?:[-–—,]\\s*)?\\b${escapeRegExp(phrase)}\\b`,
      "gi",
    );
    if (re.test(text)) {
      capturedNotes.push(phrase);
      text = text.replace(re, " ");
    }
  }

  // Drop stray "*" anywhere (often used as a formatting marker by recipe
  // sites: "*Hackfleisch", "Salz*").
  text = text.replace(/\*/g, " ");

  // Strip leading/trailing throwaway punctuation: "+", "&", "·", "•", etc.
  // (Section-header heuristics ran earlier; here we only see ingredients.)
  text = text.replace(/^[\s+&·•●◦|]+|[\s+&·•|]+$/g, "");

  // Strip leading filler conjunctions/articles: "und ", "and ", "the ".
  text = text.replace(
    /^(?:und|and|the|der|die|das|of|von|vom|or|oder|sowie|plus)\s+/i,
    "",
  );

  // " / " and " o. " → " or " — keep both alternatives but route them through
  // the existing NOTE_BOUNDARY logic.
  text = text.replace(/\s+\/\s+/g, " or ").replace(/\s+o\.\s+/gi, " or ");

  // "Amount at end" via colon: "Flohsamenschalenpulver: 30 g" → "30 g Flohsamenschalenpulver"
  const colonAmount = /^(.+?):\s*([\d\s./,\-–½¼¾⅓⅔⅛⅜⅝⅞]+(?:\s+\p{L}{1,30})?)\s*$/u.exec(text);
  if (colonAmount) {
    const namePart = colonAmount[1].trim();
    const amountPart = colonAmount[2].trim();
    text = `${amountPart} ${namePart}`;
  }

  // Compound size-unit dash like "12-count", "14-ounce", "1-inch", "4-inch":
  //   - If the next token is a container word (package, can, tin, Dose, …),
  //     the compound describes the container's size — demote to a note and
  //     let the container word become the unit.
  //         "14-ounce can of black beans" → unit "can", note "14 ounce"
  //   - Otherwise the compound IS the quantity + unit — strip just the dash
  //     so the regular parser sees "4 inch stems …" → unit "inch", qty 4.
  const CONTAINER_RE = /(?:package|packages|packet|packets|can|cans|tin|tins|jar|jars|bottle|bottles|tube|tubes|box|boxes|dose|dosen|packung|päckchen|pck|pkg|carton|cartons)/i;
  text = text.replace(
    /(\d+)[-–](count|ounce|ounces|oz|inch|inches|gram|grams|g|kg|ml|l|lb|pound|pounds)\b(\s*)(\S*)/gi,
    (match, num: string, sizeUnit: string, ws: string, next: string) => {
      if (next && CONTAINER_RE.test(next)) {
        capturedNotes.push(`${num} ${sizeUnit}`);
        return `${ws}${next}`;
      }
      return `${num} ${sizeUnit}${ws}${next}`;
    },
  );

  // Parenthesized size like "(28 oz.) can" → drop into notes, keep the main
  // amount/unit/name unaffected.
  text = text.replace(/\(\s*([\d\s./,\-–½¼¾⅓⅔⅛⅜⅝⅞]+\s+\p{L}{1,30}\.?)\s*\)/gu,
    (_match, inner: string) => {
      capturedNotes.push(inner.trim());
      return " ";
    },
  );

  // Collapse whitespace.
  text = text.replace(/\s+/g, " ").trim();
  return { text, capturedNotes };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(s: string): string {
  return (
    s
      .replace(/\s+/g, " ")
      // Spaced decimal commas/dots — Familywall sometimes serves "0, 5" or
      // "1 . 5". Collapse to "0,5" / "1.5" before tokenising so the numeric
      // matchers see them as one token.
      .replace(/(\d)\s+([.,])\s*(\d)/g, "$1$2$3")
      .replace(/(\d)([.,])\s+(\d)/g, "$1$2$3")
      // Pseudo-pluralization markers in scraped German recipes:
      //   "Tomate(n)" → "Tomate", "Zehe(n)" → "Zehe", "Dose/n" → "Dose"
      .replace(/([\p{L}]+)\((\p{L}{1,3})\)/gu, "$1")
      .replace(/([\p{L}]+)\/\p{L}{1,3}\b/gu, "$1")
      // "Weizen- oder Dinkelmehl" — dash followed by alternative-word: glue
      // the parts together so the splitter / boundary logic doesn't split it.
      // We preserve the dash to keep it visually faithful.
      .replace(
        /([\p{L}]+)-\s+(oder|or|bzw\.?|alternativ|alternatively)\s+/giu,
        "$1- $2 ",
      )
      .trim()
  );
}

function tokenize(input: string): string[] {
  const padded = input
    .replace(/(?<!\d),|,(?!\d)/g, " , ")
    .replace(/([;()])/g, " $1 ")
    // Inch symbol attached to a number: 1" → 1 "
    .replace(/(\d)"/g, '$1 "')
    .replace(/(\d)([½¼¾⅓⅔⅛⅜⅝⅞])/g, "$1 $2")
    .replace(/(\d)([a-zA-ZäöüÄÖÜß])/g, "$1 $2")
    .replace(/([½¼¾⅓⅔⅛⅜⅝⅞])([a-zA-ZäöüÄÖÜß])/g, "$1 $2");
  return padded.split(/\s+/).filter((t) => t.length > 0);
}

/**
 * Drop leading filler tokens that snuck through the preprocess regex (they
 * may appear after a quantity-or-unit prefix has been consumed too).
 */
function dropLeadingFiller(tokens: string[]): void {
  while (tokens.length > 0) {
    const lower = tokens[0].toLowerCase().replace(/[.,;]$/, "");
    if (NAME_FILLER_TOKENS.has(lower)) {
      tokens.shift();
    } else {
      break;
    }
  }
}

export function parseIngredientString(
  raw: string,
  knownUnitTokens: ReadonlySet<string>,
): ParsedIngredient {
  const { text: preprocessed, capturedNotes } = preprocess(raw);
  const cleaned = normalize(preprocessed);
  if (cleaned.length === 0) {
    const notes =
      capturedNotes.length > 0 ? capturedNotes.join(", ") : null;
    return { quantity: null, unitName: null, name: "", notes };
  }
  const tokens = tokenize(cleaned);

  dropLeadingFiller(tokens);

  // Quantity may be a text amount ("Eine Prise", "a pinch"), a vague amount
  // ("Etwas Salz"), a numeric range, or a single number.
  let quantity: number | null = null;
  const rangeNotes: string[] = [];

  if (tokens.length > 0) {
    const firstLower = tokens[0].toLowerCase();
    if (TEXT_AMOUNT_VAGUE.has(firstLower)) {
      capturedNotes.push(tokens[0]);
      tokens.shift();
      quantity = null;
    } else if (TEXT_AMOUNT_ONE.has(firstLower)) {
      tokens.shift();
      quantity = 1;
    } else {
      const range = consumeQuantity(tokens);
      if (range) {
        quantity = range.quantity;
        if (range.rangeExpression) rangeNotes.push(range.rangeExpression);
      }
    }
  }

  // Pull off any size modifiers between the quantity and the unit.
  const sizeModifiers: string[] = [];
  while (tokens.length > 0) {
    const lower = tokens[0].toLowerCase().replace(/\.$/, "");
    if (SIZE_MODIFIER_TOKENS.has(lower)) {
      sizeModifiers.push(tokens.shift()!);
    } else {
      break;
    }
  }

  // Optional unit: matched against the DB-derived token set.
  let unitName: string | null = null;
  if (tokens.length > 0) {
    const candidate = tokens[0];
    const lower = candidate.toLowerCase();
    const stripped = lower.replace(/\.$/, "");
    if (
      knownUnitTokens.has(lower) ||
      knownUnitTokens.has(stripped) ||
      knownUnitTokens.has(`${stripped}.`)
    ) {
      unitName = candidate.replace(/\.$/, "");
      tokens.shift();
      // Fallback: unit present but no amount → default to 1.
      if (quantity === null) quantity = 1;
    }
  }

  // Drop a leading filler word between unit and name ("of", "von", "and").
  dropLeadingFiller(tokens);

  // Detect a leading "usage" phrase ("zum Bestreuen", "for drizzling") that
  // shouldn't be part of the name.
  const nameTokens: string[] = [];
  const noteTokens: string[] = [];
  let inNotes = false;
  let parenDepth = 0;
  for (const t of tokens) {
    if (t === "(") {
      parenDepth += 1;
      continue;
    }
    if (t === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (parenDepth > 0) {
      noteTokens.push(t);
      continue;
    }
    const lower = t.toLowerCase();
    if (!inNotes && t === ",") {
      inNotes = true;
      continue;
    }
    if (t === "," || t === ";") {
      if (inNotes) noteTokens.push(",");
      continue;
    }
    if (!inNotes && USAGE_PREFIX_TOKENS.has(lower) && nameTokens.length > 0) {
      inNotes = true;
      noteTokens.push(t);
      continue;
    }
    if (!inNotes && NOTE_BOUNDARY_TOKENS.has(lower)) {
      // Dash-compound exception: "Weizen- oder Dinkelmehl" — when the
      // preceding name token ends with a hyphen, keep the conjunction (and
      // everything after it) in the name. Splitting here would orphan the
      // half-word "Weizen-".
      const prev = nameTokens[nameTokens.length - 1];
      if (prev && (prev.endsWith("-") || prev.endsWith("–"))) {
        nameTokens.push(t);
        continue;
      }
      inNotes = true;
      noteTokens.push(t);
      continue;
    }
    // Standalone dash separator: "Flaked Almond - to taste" — when a name has
    // already been collected, a bare dash demotes the rest to notes.
    if (!inNotes && (t === "-" || t === "–") && nameTokens.length > 0) {
      inNotes = true;
      continue;
    }
    (inNotes ? noteTokens : nameTokens).push(t);
  }

  // Tidy: trim trailing filler from the name area.
  while (
    nameTokens.length > 0 &&
    NAME_FILLER_TOKENS.has(
      nameTokens[nameTokens.length - 1].toLowerCase().replace(/[.,;]$/, ""),
    )
  ) {
    nameTokens.pop();
  }
  // Same at the start, in case all previous strips missed anything.
  while (
    nameTokens.length > 0 &&
    NAME_FILLER_TOKENS.has(nameTokens[0].toLowerCase().replace(/[.,;]$/, ""))
  ) {
    nameTokens.shift();
  }
  // Drop a trailing bare unit-noise token if it managed to land in the name
  // (e.g. lonely "package" left over after the "(28 oz.) can" path).
  while (
    nameTokens.length > 1 &&
    SIZE_UNIT_TOKENS_RE.test(nameTokens[nameTokens.length - 1])
  ) {
    nameTokens.pop();
  }

  const name = nameTokens
    .join(" ")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const noteBody =
    noteTokens
      .join(" ")
      .replace(/[()]/g, "")
      .replace(/\s+/g, " ")
      .replace(/^[\s,;]+|[\s,;]+$/g, "")
      .trim();
  const sizeNote = sizeModifiers.join(" ").trim();
  const notes =
    [sizeNote, ...rangeNotes, noteBody, ...capturedNotes]
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join(", ") || null;

  return { quantity, unitName, name, notes };
}

/**
 * Split a raw line into one OR MORE ingredient strings by separating on
 * "und"/"and"/"&" — but only when they look like list separators, not when
 * they continue a dash-compounded name ("Weizen- oder Dinkelmehl").
 *
 * Returns the original line as a single-element array when no split applies,
 * so the existing single-output parser is the no-op path.
 */
export function splitConjunctions(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];

  // Don't split when the conjunction is part of a dash-compound like
  // "Weizen- oder Dinkelmehl" (handled by normalize() in the parser too).
  // Also: never split when the conjunction is inside parentheses or
  // brackets — those describe a single ingredient ("medium onion (½ chopped
  // & ½ sliced)"), not a list.
  // Strategy: walk forward, track paren/bracket depth, and split only at
  // " und " / " and " / " & " encountered at depth 0 and not preceded by "-".
  const SPLIT_RE = /\s+(?:und|and|&)\s+/gi;
  const parts: string[] = [];
  let lastIndex = 0;

  function depthAt(idx: number): number {
    let depth = 0;
    for (let i = 0; i < idx; i++) {
      const c = trimmed[i];
      if (c === "(" || c === "[") depth += 1;
      else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    }
    return depth;
  }

  for (const match of trimmed.matchAll(SPLIT_RE)) {
    const idx = match.index ?? 0;
    if (depthAt(idx) > 0) continue;
    const before = trimmed.slice(0, idx);
    const beforeTrimmed = before.replace(/\s+$/, "");
    const lastChar = beforeTrimmed[beforeTrimmed.length - 1];
    if (lastChar === "-" || lastChar === "–") continue;

    parts.push(trimmed.slice(lastIndex, idx).trim());
    lastIndex = idx + match[0].length;
  }
  parts.push(trimmed.slice(lastIndex).trim());

  const cleaned = parts.filter((p) => p.length > 0);
  return cleaned.length === 0 ? [trimmed] : cleaned;
}
