/**
 * Pure numeric-value parsing for ingredient amounts. Copied verbatim from the
 * legacy `ingredient.ts` (these are pure, well-tested functions — re-deriving
 * the fraction/range/decimal math would only add risk). The AST amount pass
 * calls these over the source slices of a segment's leading numeric leaves.
 */

import { toFractionDisplay } from "@/lib/units/fraction";

export const FRACTIONS: Record<string, number> = {
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

export const NUMERIC_TOKEN_RE = /^[\d./,\-–½¼¾⅓⅔⅛⅜⅝⅞]+$/;

export const APPROX_TOKENS_RE =
  /^(ca\.?|etwa|about|approx\.?|approximately|roughly|ungefähr|je|alternativ|alternative)$/i;

export function parseSingleNumericToken(t: string): number | null {
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

export function evaluateNumericSequence(tokens: string[]): number | null {
  if (tokens.length === 0) return null;
  let total = 0;
  for (const t of tokens) {
    const v = parseSingleNumericToken(t);
    if (v === null) return null;
    total += v;
  }
  return total;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function formatRangeNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const fraction = toFractionDisplay(n);
  if (fraction) return fraction;
  return n
    .toFixed(2)
    .replace(/0+$/, "")
    .replace(/[.,]$/, "")
    .replace(".", ",");
}

export type RangeResult = {
  quantity: number;
  /** Original "lo-hi" expression when the input was a range, else null. */
  rangeExpression: string | null;
};

/**
 * Consume a quantity from the start of `tokens` (mutates: shifts consumed
 * tokens off the front). Returns the parsed number (max value for a range) and,
 * when it was a range, the original expression for the notes.
 */
export function consumeQuantity(tokens: string[]): RangeResult | null {
  if (tokens.length === 0) return null;
  let bisPrefix = false;
  if (/^bis$/i.test(tokens[0])) {
    bisPrefix = true;
    tokens.shift();
  }
  if (tokens.length > 0 && APPROX_TOKENS_RE.test(tokens[0])) tokens.shift();
  if (tokens.length === 0) return null;

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
    if (
      /^(?:to|bis)$/i.test(tokens[0]) &&
      numericRun.length > 0 &&
      tokens.length > 1 &&
      NUMERIC_TOKEN_RE.test(tokens[1])
    ) {
      tokens.shift();
      numericRun.push("-");
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
  const max = Math.max(...values);
  const rangeExpression = bisPrefix
    ? `bis ${formatRangeNumber(values[values.length - 1])}`
    : values.map(formatRangeNumber).join("-");
  return { quantity: round3(max), rangeExpression };
}
