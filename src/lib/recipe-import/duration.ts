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
  // ISO 8601 duration. We honor the W/D parts in addition to H/M/S — some
  // sites (e.g. chefkoch.de stamps "P0DT0H20M") include a zero days portion
  // even for short cooking times, and the occasional marinade-overnight
  // recipe genuinely uses days. Years and months aren't meaningful for
  // cooking times so we don't bother.
  const m =
    /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
      s,
    );
  if (!m) return null;
  const weeks = m[1] ? parseInt(m[1], 10) : 0;
  const days = m[2] ? parseInt(m[2], 10) : 0;
  const hours = m[3] ? parseInt(m[3], 10) : 0;
  const minutes = m[4] ? parseInt(m[4], 10) : 0;
  const seconds = m[5] ? parseFloat(m[5]) : 0;
  const total =
    weeks * 7 * 24 * 60 +
    days * 24 * 60 +
    hours * 60 +
    minutes +
    seconds / 60;
  if (total <= 0) return null;
  return Math.round(total);
}
