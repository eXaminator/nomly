export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  return ISO_DATE_RE.test(s);
}

export function todayIso(): string {
  // Server's local date — the planner buckets meals by calendar day in the
  // server's timezone (matches the API contract in §5).
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, n: number): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Returns ISO weekday (1=Mon … 7=Sun) for an ISO date string. */
export function isoWeekday(iso: string): number {
  const dt = new Date(`${iso}T00:00:00Z`);
  return ((dt.getUTCDay() + 6) % 7) + 1;
}

/**
 * Align the visible window so that `from` is the most recent date ≤ today
 * whose ISO weekday matches `startWeekday`. This is what the "Heute" button
 * snaps to.
 */
export function alignToStartWeekday(
  today: string,
  startWeekday: number,
): string {
  const wd = isoWeekday(today);
  const back = (wd - startWeekday + 7) % 7;
  return addDays(today, -back);
}

export function buildRange(from: string, daysVisible: number): {
  from: string;
  to: string;
  dates: string[];
} {
  const dates: string[] = [];
  for (let i = 0; i < daysVisible; i++) dates.push(addDays(from, i));
  return { from, to: dates[dates.length - 1], dates };
}

const WEEKDAY_SHORT_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WEEKDAY_LONG_DE = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

export function formatWeekdayShortDe(iso: string): string {
  return WEEKDAY_SHORT_DE[isoWeekday(iso) - 1];
}

export function formatWeekdayLongDe(iso: string): string {
  return WEEKDAY_LONG_DE[isoWeekday(iso) - 1];
}

export function formatDayMonthDe(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.`;
}
