/**
 * Decimal → fraction display for units flagged with `displayFraction`.
 *
 * Quantities are stored as decimals (a recipe's "¼ TL" is persisted as 0.25),
 * but for spoon/cup style units a fraction reads far more naturally than
 * "0,25". This module is the inverse of the FRACTIONS map the importer uses to
 * parse glyphs, so display stays consistent with parsing.
 *
 * Pure (no DB, no locale state) so it is unit-testable and reusable across the
 * recipe read view, the planner preview, and the bulk-reparse diff.
 */

/** Denominators we are willing to express as a fraction. Every reduced
 *  fraction over these has a Unicode glyph, but {@link renderFraction} still
 *  falls back to slash text for any future denominator that doesn't. */
const DEFAULT_DENOMINATORS = [2, 3, 4, 6, 8];

/** Half the 2-decimal rounding step: a hand-typed "0,33" resolves to ⅓, while
 *  "0,3" (3/10) stays a decimal. */
const DEFAULT_TOLERANCE = 0.005;

/** Reduced fraction → Unicode vulgar-fraction glyph. */
const GLYPHS: Record<string, string> = {
  "1/2": "½",
  "1/3": "⅓",
  "2/3": "⅔",
  "1/4": "¼",
  "3/4": "¾",
  "1/8": "⅛",
  "3/8": "⅜",
  "5/8": "⅝",
  "7/8": "⅞",
  "1/6": "⅙",
  "5/6": "⅚",
};

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Render a single fraction: its Unicode glyph when one exists, else `n/d`. */
export function renderFraction(numerator: number, denominator: number): string {
  return GLYPHS[`${numerator}/${denominator}`] ?? `${numerator}/${denominator}`;
}

/**
 * Express `value` as a fraction string ("¼", "1½", "1/5") when it is close to a
 * clean fraction over one of {@link DEFAULT_DENOMINATORS}. Whole numbers,
 * non-finite, null, negative, and "unclean" values (e.g. 0.4) return null so
 * the caller can fall back to the normal decimal formatter.
 */
export function toFractionDisplay(
  value: number | null,
  denominators: number[] = DEFAULT_DENOMINATORS,
  tolerance: number = DEFAULT_TOLERANCE,
): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;

  const whole = Math.floor(value);
  const remainder = value - whole;

  // A whole number (or one within tolerance of it) is best shown as a plain
  // integer by the decimal formatter.
  if (remainder <= tolerance || remainder >= 1 - tolerance) return null;

  let best: { num: number; den: number; error: number } | null = null;
  for (const den of denominators) {
    const num = Math.round(remainder * den);
    if (num <= 0 || num >= den) continue;
    const error = Math.abs(remainder - num / den);
    if (error >= tolerance) continue;
    // Prefer the closest match; ties go to the smaller denominator, which the
    // ascending iteration order already gives us.
    if (best === null || error < best.error) best = { num, den, error };
  }
  if (best === null) return null;

  const divisor = gcd(best.num, best.den);
  const num = best.num / divisor;
  const den = best.den / divisor;
  const fraction = renderFraction(num, den);

  if (whole === 0) return fraction;
  // Glyphs join tight ("1½"); slash fractions need a separating space ("1 1/5").
  const glyphed = fraction.length === 1;
  return glyphed ? `${whole}${fraction}` : `${whole} ${fraction}`;
}
