import type { IngredientPurchaseStats } from "./purchase-stats.ts";

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Format a purchase timestamp (unix seconds) as a German date. */
export function formatPurchaseDate(purchasedAt: number): string {
  return dateFmt.format(new Date(purchasedAt * 1000));
}

/** Whole days between a past purchase timestamp (unix seconds) and now. */
export function daysSince(
  purchasedAt: number,
  nowMs: number = Date.now(),
): number {
  const diffMs = nowMs - purchasedAt * 1000;
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

/** "zuletzt gekauft"-Text, e.g. "vor 3 Tagen" / "heute" / "gestern". */
export function formatLastPurchasedRelative(
  purchasedAt: number,
  nowMs: number = Date.now(),
): string {
  const days = daysSince(purchasedAt, nowMs);
  if (days === 0) return "heute";
  if (days === 1) return "gestern";
  return `vor ${days} Tagen`;
}

/** "im Schnitt alle N Tage" text, rounded to one decimal where helpful. */
export function formatAverageInterval(averageIntervalDays: number): string {
  const rounded =
    averageIntervalDays >= 10
      ? Math.round(averageIntervalDays)
      : Math.round(averageIntervalDays * 10) / 10;
  const num = new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 1,
  }).format(rounded);
  return `alle ${num} Tage`;
}

/**
 * Compact one-line summary used in the ingredient list column. Returns null
 * when the ingredient has never been bought (nothing to show).
 */
export function formatPurchaseStatsShort(
  stats: IngredientPurchaseStats,
  nowMs: number = Date.now(),
): string | null {
  if (stats.lastPurchasedAt == null) return null;
  const last = formatLastPurchasedRelative(stats.lastPurchasedAt, nowMs);
  if (stats.averageIntervalDays == null) return last;
  return `${last} · ${formatAverageInterval(stats.averageIntervalDays)}`;
}
