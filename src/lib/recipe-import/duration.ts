/**
 * Parse an ISO 8601 duration string ("PT1H30M", "PT45M", "PT2H") to total
 * minutes. Returns null for unparseable input. Schema.org uses these for
 * Recipe.prepTime / cookTime / totalTime.
 *
 * We accept either the canonical "PT…" form or a bare integer number of
 * minutes — some sites stamp `"prepTime": 30` into JSON-LD even though that's
 * non-conformant.
 */
export function parseIsoDurationToMinutes(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === "number" && Number.isFinite(input) && input >= 0) {
    return Math.round(input);
  }
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (s.length === 0) return null;
  // Bare integer? Treat as minutes.
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  // ISO 8601 duration. We only honor the H/M/S parts — days/weeks aren't
  // meaningful for cooking times.
  const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(s);
  if (!m) return null;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  const seconds = m[3] ? parseFloat(m[3]) : 0;
  const total = hours * 60 + minutes + seconds / 60;
  if (total <= 0) return null;
  return Math.round(total);
}
