/**
 * Drops ISO dates before `today`. Used by the dashboard's upcoming-meals card
 * so a stale SW-cached snapshot never shows past days — the client re-filters
 * with the device's current date at view time. ISO yyyy-mm-dd strings compare
 * correctly lexicographically.
 */
export function filterUpcomingDates(
  dates: ReadonlyArray<string>,
  today: string,
): string[] {
  return dates.filter((d) => d >= today);
}
