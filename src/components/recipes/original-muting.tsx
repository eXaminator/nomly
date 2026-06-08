import * as React from "react";

export type HighlightKind = "amount" | "name" | "note" | "dropped";
export type HighlightPart = { range: [number, number]; kind: HighlightKind };

/** Colour per category — amount/unit and name in distinct hues so the parse
 *  decisions read at a glance; notes stay neutral-but-legible; words the parser
 *  dropped (connectors, stripped markers) are struck through. */
const KIND_CLASS: Record<HighlightKind, string> = {
  amount: "font-medium text-[var(--color-accent)]",
  name: "font-medium text-[var(--color-success)]",
  note: "text-[var(--color-fg)]",
  dropped: "line-through opacity-60",
};

/**
 * Render an "Original:" source line, colouring the parts that map to this row's
 * amount/unit, name and notes in distinct tones and muting everything else
 * (text that belongs to other rows or was dropped by the parser). Returns the
 * plain string when no parts are known (e.g. a row loaded from a saved recipe),
 * keeping the line's usual muted look.
 */
export function renderOriginalWithMuting(
  text: string,
  parts: HighlightPart[],
): React.ReactNode {
  const clamped = parts
    .map((p) => ({
      range: [Math.max(0, p.range[0]), Math.min(text.length, p.range[1])] as [number, number],
      kind: p.kind,
    }))
    .filter((p) => p.range[1] > p.range[0])
    .sort((a, b) => a.range[0] - b.range[0]);
  if (clamped.length === 0) return text;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  clamped.forEach((p, i) => {
    const [s, e] = p.range;
    // Overlap guard: never render the same char twice.
    const start = Math.max(s, cursor);
    if (start > cursor) {
      out.push(
        <span key={`mute-${i}`} className="opacity-50">
          {text.slice(cursor, start)}
        </span>,
      );
    }
    if (e > start) {
      out.push(
        <span key={`part-${i}`} className={KIND_CLASS[p.kind]}>
          {text.slice(start, e)}
        </span>,
      );
      cursor = e;
    }
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
