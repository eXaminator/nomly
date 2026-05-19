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
      // Restrict the inner part to 1-3 letters so we don't strip real
      // notes ("Erdnussbutter (creamy)") or genuine alternatives
      // ("Salz/Pfeffer").
      .replace(/([\p{L}]+)\((\p{L}{1,3})\)/gu, "$1")
      .replace(/([\p{L}]+)\/\p{L}{1,3}\b/gu, "$1")
      .trim()
  );
}

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
 * Filler words to drop between a unit and the ingredient name —
 * "100g of caster sugar" → ignore "of"; same for German "100g von Zucker".
 */
const NAME_FILLER_TOKENS = new Set(["of", "von"]);

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

const NUMERIC_TOKEN_RE = /^[\d./,\-–½¼¾⅓⅔⅛⅜⅝⅞]+$/;

function parseSingleNumericToken(t: string): number | null {
  // Unicode fraction glyph alone or attached to a whole number: "1½", "½"
  const glyph = /^(\d+)?([½¼¾⅓⅔⅛⅜⅝⅞])$/.exec(t);
  if (glyph) {
    const whole = glyph[1] ? parseInt(glyph[1], 10) : 0;
    return whole + FRACTIONS[glyph[2]];
  }
  // ASCII fraction: 1/2
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) {
    const den = parseInt(frac[2], 10);
    if (den <= 0) return null;
    return parseInt(frac[1], 10) / den;
  }
  // Decimal / integer, with or without a leading whole part:
  //   1.5, 1,5, 100, .5, ,5
  const num = /^(\d+(?:[.,]\d+)?|[.,]\d+)$/.exec(t);
  if (num) return parseFloat(num[1].replace(",", "."));
  return null;
}

/**
 * Evaluate a sequence of numeric tokens as a single quantity, summing them
 * (handles mixed fractions like "1 1/2" or "1 ½"). Returns null if any
 * token can't be parsed.
 */
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

/**
 * Try to consume a quantity from the start of `tokens` (mutates by shifting).
 * Handles `1`, `1.5`, `1,5`, `1/2`, `1 1/2`, `½`, `1 ½`, ranges like
 * `100-200`, `1/2-1`, `1- 1 1/2` (averaged), and a leading "ca." that's
 * stripped.
 */
function consumeQuantity(tokens: string[]): number | null {
  if (tokens.length === 0) return null;
  // Strip leading approximation markers.
  if (/^(ca\.?|etwa|about|approx\.?)$/i.test(tokens[0])) tokens.shift();
  if (tokens.length === 0) return null;

  // Grab every leading numeric-looking token so we can decide if they form a
  // range (with embedded dashes) or a single value.
  const numericRun: string[] = [];
  while (tokens.length > 0 && NUMERIC_TOKEN_RE.test(tokens[0])) {
    numericRun.push(tokens.shift()!);
  }
  if (numericRun.length === 0) return null;

  // Reassemble the run as a single string so dashes inside (or between)
  // tokens become a single normalised separator.
  const expr = numericRun.join(" ");
  const parts = expr.split(/\s*[-–]\s*/).filter((p) => p.length > 0);
  if (parts.length === 0) return null;

  const values: number[] = [];
  for (const p of parts) {
    const v = evaluateNumericSequence(p.split(/\s+/).filter(Boolean));
    if (v !== null) values.push(v);
  }
  if (values.length === 0) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(avg * 1000) / 1000;
}

function tokenize(input: string): string[] {
  // Pre-pad punctuation we want as standalone tokens. Use lookarounds so
  // commas between digits stay attached (German decimals like "0,5").
  const padded = input
    .replace(/(?<!\d),|,(?!\d)/g, " , ")
    .replace(/([;()])/g, " $1 ")
    // Split unicode fractions touching numbers: "1½" → "1 ½"
    .replace(/(\d)([½¼¾⅓⅔⅛⅜⅝⅞])/g, "$1 $2")
    // Split digits attached to letters so "500g" or "1/2tsp" still parses
    // as quantity + unit. Doesn't touch number formats themselves (the
    // decimal-comma exception above runs first, and dots inside numbers
    // are matched by NUMERIC_TOKEN_RE later).
    .replace(/(\d)([a-zA-ZäöüÄÖÜß])/g, "$1 $2")
    // Same for a fraction glyph followed by a unit letter ("½tsp" → "½ tsp").
    .replace(/([½¼¾⅓⅔⅛⅜⅝⅞])([a-zA-ZäöüÄÖÜß])/g, "$1 $2");
  return padded.split(/\s+/).filter((t) => t.length > 0);
}

export function parseIngredientString(
  raw: string,
  knownUnitTokens: ReadonlySet<string>,
): ParsedIngredient {
  const cleaned = normalize(raw);
  if (cleaned.length === 0) {
    return { quantity: null, unitName: null, name: "", notes: null };
  }
  const tokens = tokenize(cleaned);

  const quantity = consumeQuantity(tokens);

  // Pull off any size modifiers between the quantity and the unit
  // ("1 kl. Dose Bohnen" → modifier="kl.", unit="Dose"). They go into the
  // notes so the size hint isn't lost.
  const sizeModifiers: string[] = [];
  while (tokens.length > 0) {
    const lower = tokens[0].toLowerCase().replace(/\.$/, "");
    if (SIZE_MODIFIER_TOKENS.has(lower)) {
      sizeModifiers.push(tokens.shift()!);
    } else {
      break;
    }
  }

  // Optional unit: only treat the first remaining token as a unit when
  // the DB knows it (canonical name or alias, case-insensitive). Otherwise
  // leave it as part of the name — random adjectives shouldn't get demoted
  // to "unit". `knownUnitTokens` is built from `unit.name ∪ unit_alias.name`
  // by the caller (see buildUnitLookup), so adding a new alias to the DB
  // is enough to teach the parser the new token.
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
    }
  }

  // Drop a leading filler word between unit and name ("of", "von").
  while (tokens.length > 0 && NAME_FILLER_TOKENS.has(tokens[0].toLowerCase())) {
    tokens.shift();
  }

  // Split into name vs. notes:
  // - Tokens inside `(...)` always go to notes (parens themselves are dropped).
  // - A standalone comma starts notes mode.
  // - "or", "oder", "alternative", "z.B." in the name area also start notes
  //   mode — the matched word is preserved in the notes.
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
    if (!inNotes && t === ",") {
      inNotes = true;
      continue;
    }
    if (t === "," || t === ";") {
      if (inNotes) noteTokens.push(",");
      continue;
    }
    if (!inNotes && NOTE_BOUNDARY_TOKENS.has(t.toLowerCase())) {
      // The boundary word itself joins the notes so a reader sees the
      // relationship ("Butter oder Margarine" → notes: "oder Margarine").
      inNotes = true;
      noteTokens.push(t);
      continue;
    }
    (inNotes ? noteTokens : nameTokens).push(t);
  }

  const name = nameTokens.join(" ").replace(/[()]/g, "").replace(/\s+/g, " ").trim();
  // Defensive: even though the loop above drops `(` / `)` tokens entirely,
  // strip any that slipped through (e.g. unbalanced parens from messy input)
  // and tidy resulting double-spaces / trailing punctuation.
  const noteBody =
    noteTokens
      .join(" ")
      .replace(/[()]/g, "")
      .replace(/\s+/g, " ")
      .replace(/^[\s,;]+|[\s,;]+$/g, "")
      .trim();
  const sizeNote = sizeModifiers.join(" ").trim();
  const notes =
    [sizeNote, noteBody].filter((p) => p.length > 0).join(", ") || null;

  return { quantity, unitName, name, notes };
}
