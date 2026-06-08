import * as React from "react";

export type Range = [number, number];

/**
 * Render an "Original:" source line with the parts that did NOT contribute to
 * this row muted, leaving the row's own + inherited spans (amount, unit, name,
 * notes) at full emphasis. `ranges` are `[start, end)` offsets into `text`.
 *
 * Returns the plain string only when no ranges are known (e.g. a row loaded
 * from a saved recipe, where the parser's source mapping isn't available). When
 * ranges ARE known they're emphasised even if they cover the whole line — so
 * for a lone ingredient every mapped part (including its notes) is highlighted
 * and only genuinely-dropped text is muted.
 */
export function renderOriginalWithMuting(
  text: string,
  ranges: Range[],
): React.ReactNode {
  if (ranges.length === 0) return text;
  const clamped = ranges
    .map(([s, e]) => [Math.max(0, s), Math.min(text.length, e)] as Range)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  if (clamped.length === 0) return text;
  const merged: Range[] = [];
  for (const [s, e] of clamped) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const out: React.ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([s, e], i) => {
    if (s > cursor) {
      out.push(
        <span key={`mute-${i}`} className="opacity-50">
          {text.slice(cursor, s)}
        </span>,
      );
    }
    out.push(
      <span key={`keep-${i}`} className="text-[var(--color-fg)]">
        {text.slice(s, e)}
      </span>,
    );
    cursor = e;
  });
  if (cursor < text.length) {
    out.push(
      <span key="mute-end" className="opacity-50">
        {text.slice(cursor)}
      </span>,
    );
  }
  return out;
}
