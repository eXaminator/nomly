/**
 * Heuristic parser for an ingredient string of the form
 *   "500 g Hackfleisch, fein gewürfelt"
 * → { quantity: 500, unit: "g", name: "Hackfleisch", notes: "fein gewürfelt" }
 *
 * Designed for German recipe sources (Chefkoch, Lecker, …) but tolerates the
 * common English forms found in JSON-LD too. There is no controlled vocabulary
 * — the unit string is returned verbatim and resolved against `unit.name` /
 * `unit_alias.name` later (the user can fix it before saving anyway).
 */

const COMMON_UNIT_TOKENS = new Set(
  [
    // metric mass
    "g", "kg", "mg",
    // metric volume
    "ml", "cl", "dl", "l",
    // imperial / US
    "oz", "lb", "lbs", "pound", "pounds", "ounce", "ounces",
    "cup", "cups", "tbsp", "tsp", "teaspoon", "teaspoons",
    "tablespoon", "tablespoons", "floz",
    // German cooking
    "el", "tl", "msp", "prise", "prisen", "bund", "bunde",
    "stück", "stk", "stk.", "dose", "dosen", "flasche", "flaschen",
    "becher", "packung", "packungen", "pkg", "päckchen",
    "scheibe", "scheiben", "zehe", "zehen", "blatt", "blätter",
    // generic
    "n.b.", "n.b",
  ].map((u) => u.toLowerCase()),
);

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
  return s.replace(/\s+/g, " ").trim();
}

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
  // Decimal / integer: 1.5, 1,5, 100
  const num = /^(\d+(?:[.,]\d+)?)$/.exec(t);
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

export function parseIngredientString(raw: string): ParsedIngredient {
  const cleaned = normalize(raw);
  if (cleaned.length === 0) {
    return { quantity: null, unitName: null, name: "", notes: null };
  }
  const tokens = tokenize(cleaned);

  const quantity = consumeQuantity(tokens);

  // Optional unit: only treat the first remaining token as a unit when
  // it's in the known list (case-insensitive). Otherwise leave it as part
  // of the name — random adjectives shouldn't get demoted to "unit".
  let unitName: string | null = null;
  if (tokens.length > 0) {
    const candidate = tokens[0];
    const lower = candidate.toLowerCase().replace(/\.$/, "");
    if (COMMON_UNIT_TOKENS.has(lower) || COMMON_UNIT_TOKENS.has(`${lower}.`)) {
      unitName = candidate.replace(/\.$/, "");
      tokens.shift();
    }
  }

  // Everything up to the first standalone comma is the name; the rest is notes.
  const nameTokens: string[] = [];
  const noteTokens: string[] = [];
  let inNotes = false;
  for (const t of tokens) {
    if (!inNotes && t === ",") {
      inNotes = true;
      continue;
    }
    if (t === "," || t === ";") {
      if (inNotes) noteTokens.push(",");
      continue;
    }
    if (t === "(" || t === ")") {
      // Parentheses become part of notes if we're in notes, else dropped.
      if (inNotes) noteTokens.push(t);
      continue;
    }
    (inNotes ? noteTokens : nameTokens).push(t);
  }

  const name = nameTokens.join(" ").trim();
  const notes = noteTokens.join(" ").replace(/\s+/g, " ").trim() || null;

  return { quantity, unitName, name, notes };
}
