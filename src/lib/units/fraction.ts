/**
 * Decimal → fraction display for units flagged with `displayFraction`.
 *
 * Quantities are stored as decimals (a recipe's "1/4 TL" is persisted as
 * 0.25), but for spoon/cup style units a fraction reads far more naturally
 * than "0,25". Fractions render as plain slash text ("1/4", "1 1/2") — full-
 * size digits everywhere, unlike the precomposed Unicode glyphs (¼), whose
 * built-in numerals are too small to read.
 *
 * This module is the inverse of the fraction parsing the importer does, so
 * display stays consistent with parsing. Pure (no DB, no locale state) so it
 * is unit-testable and reusable across the recipe read view, the planner
 * preview, and the bulk-reparse diff.
 */

/** Denominators we are willing to express as a fraction. */
const DEFAULT_DENOMINATORS = [2, 3, 4, 6, 8];

/** Half the 2-decimal rounding step: a hand-typed "0,33" resolves to 1/3,
 *  while "0,3" (3/10) stays a decimal. */
const DEFAULT_TOLERANCE = 0.005;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Express `value` as a fraction string ("1/4", "1 1/2") when it is close to a
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
  const fraction = `${best.num / divisor}/${best.den / divisor}`;
  return whole === 0 ? fraction : `${whole} ${fraction}`;
}
