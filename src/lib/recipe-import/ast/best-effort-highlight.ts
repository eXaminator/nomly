import type { HighlightPart } from "../source-ranges";

/**
 * Best-effort highlight for a MANUAL free-text ingredient name: locate `name` as
 * a case-insensitive, word-boundary-aligned occurrence within `line` and return
 * a single "name" highlight span. Returns `[]` when the name is empty or not
 * found — the manual row is then plain free text with no source highlight.
 *
 * Boundaries use Unicode letter lookarounds so "ana" does not match inside
 * "Banane", while "Basilikum" matches in "… und Basilikum".
 */
export function bestEffortNameHighlight(name: string, line: string): HighlightPart[] {
  const needle = name.trim();
  if (needle.length === 0 || line.length === 0) return [];
  const re = new RegExp(`(?<!\\p{L})${escapeRegExp(needle)}(?!\\p{L})`, "iu");
  const m = re.exec(line);
  if (!m || m.index < 0) return [];
  return [{ kind: "name", range: [m.index, m.index + m[0].length] }];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
