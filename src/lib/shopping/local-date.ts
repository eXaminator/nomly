/**
 * ISO date (YYYY-MM-DD) of `date` in the runtime's local timezone. On the
 * client that is the device's calendar day — the day a "gab es hier heute
 * nicht" marker is stamped with and compared against.
 */
export function localDateIso(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True when `item` carries a skip marker for `supermarketId` dated `today`. */
export function isSkippedToday(
  item: { skippedAt?: ReadonlyArray<{ supermarketId: number; on: string }> },
  supermarketId: number,
  today: string,
): boolean {
  return (item.skippedAt ?? []).some(
    (s) => s.supermarketId === supermarketId && s.on === today,
  );
}
