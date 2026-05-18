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

/**
 * Try to consume a number from the start of `tokens` (mutates by shifting).
 * Handles `1`, `1.5`, `1,5`, `1/2`, `1 1/2`, `½`, `1 ½`, ranges `100-200`
 * (averaged), and a leading "ca." that's stripped.
 */
function consumeQuantity(tokens: string[]): number | null {
  if (tokens.length === 0) return null;
  // Strip leading "ca." / "ca" / "etwa".
  if (/^(ca\.?|etwa|about|approx\.?)$/i.test(tokens[0])) tokens.shift();
  if (tokens.length === 0) return null;

  let total = 0;
  let consumed = false;

  while (tokens.length > 0) {
    const t = tokens[0];

    // Unicode fraction glyph (½, ¼, …) alone or attached to a number.
    const fractionGlyphMatch = /^([0-9]+)?([½¼¾⅓⅔⅛⅜⅝⅞])$/.exec(t);
    if (fractionGlyphMatch) {
      const whole = fractionGlyphMatch[1] ? parseInt(fractionGlyphMatch[1], 10) : 0;
      total += whole + FRACTIONS[fractionGlyphMatch[2]];
      tokens.shift();
      consumed = true;
      // Don't grab another number — fractions terminate the qty.
      break;
    }

    // ASCII fraction: 1/2
    const fracMatch = /^(\d+)\/(\d+)$/.exec(t);
    if (fracMatch) {
      const num = parseInt(fracMatch[1], 10);
      const den = parseInt(fracMatch[2], 10);
      if (den > 0) {
        total += num / den;
        tokens.shift();
        consumed = true;
        break;
      }
    }

    // Range: 100-200 → average.
    const rangeMatch = /^(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)$/.exec(t);
    if (rangeMatch) {
      const lo = parseFloat(rangeMatch[1].replace(",", "."));
      const hi = parseFloat(rangeMatch[2].replace(",", "."));
      total += (lo + hi) / 2;
      tokens.shift();
      consumed = true;
      break;
    }

    // Decimal / integer: 1.5, 1,5, 100
    const numMatch = /^(\d+(?:[.,]\d+)?)$/.exec(t);
    if (numMatch) {
      total += parseFloat(numMatch[1].replace(",", "."));
      tokens.shift();
      consumed = true;
      // Look ahead one token for a follow-up fraction ("1 ½" or "1 1/2").
      const next = tokens[0];
      if (next) {
        if (/^[½¼¾⅓⅔⅛⅜⅝⅞]$/.test(next)) {
          total += FRACTIONS[next];
          tokens.shift();
          break;
        }
        if (/^\d+\/\d+$/.test(next)) {
          const fm = /^(\d+)\/(\d+)$/.exec(next)!;
          const den = parseInt(fm[2], 10);
          if (den > 0) {
            total += parseInt(fm[1], 10) / den;
            tokens.shift();
            break;
          }
        }
      }
      break;
    }

    break;
  }

  return consumed ? Math.round(total * 1000) / 1000 : null;
}

function tokenize(input: string): string[] {
  // Pre-pad punctuation we want as standalone tokens. Use lookarounds so
  // commas between digits stay attached (German decimals like "0,5").
  const padded = input
    .replace(/(?<!\d),|,(?!\d)/g, " , ")
    .replace(/([;()])/g, " $1 ")
    // Split unicode fractions touching numbers: "1½" → "1 ½"
    .replace(/(\d)([½¼¾⅓⅔⅛⅜⅝⅞])/g, "$1 $2");
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
