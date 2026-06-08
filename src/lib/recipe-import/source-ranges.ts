/**
 * Map parsed ingredient pieces back to character ranges in their original
 * source line. Used to (a) fold an alternative back into its primary's notes
 * verbatim on removal, and (b) mute the parts of the "Original:" line that did
 * not contribute to a given row.
 *
 * All ranges are `[start, end)` half-open offsets into the (trimmed) original
 * line. These are pure string functions — no parser state — so the splitter
 * pipeline stays untouched. Cases the anchored search can't resolve (text the
 * parser reassembled, Familywall pre-rewrites) return null and the caller
 * degrades gracefully (no fold span / nothing un-muted).
 */

export type SourceRange = [number, number];

/** What a highlighted span of the original line maps to. "dropped" = a word
 *  the parser discarded (it appears in NO output field — connectors like
 *  "oder", stripped markers), shown struck through. */
export type HighlightKind = "amount" | "name" | "note" | "dropped";
export type HighlightPart = { range: SourceRange; kind: HighlightKind };

const CONNECTOR_TAIL_RE =
  /(?:^|[\s(,;–-])((?:oder|or|bzw|alternativ\w*|ersatzweise|notfalls|substituted?(?:\s+with)?|sub)\.?\s*:?\s*)$/i;

/**
 * Locate `segment` in `original` at or after `cursor`. For an alternative,
 * extend the start left to swallow a leading connector ("oder", "or",
 * "Alternativ:") so the kept span reads "oder Ahornsirup", and the fold-back
 * text reproduces the source. Returns null when the segment isn't a literal
 * substring (e.g. the parser reassembled it).
 */
export function findSegmentRange(
  original: string,
  segment: string,
  cursor: number,
  withConnector: boolean,
): SourceRange | null {
  const trimmed = segment.trim();
  if (trimmed.length === 0) return null;
  const idx = original.indexOf(trimmed, cursor);
  if (idx < 0) return null;
  let start = idx;
  if (withConnector) {
    const before = original.slice(cursor, idx);
    const m = CONNECTOR_TAIL_RE.exec(before);
    if (m) start = idx - m[1].length;
  }
  return [start, idx + trimmed.length];
}

const AMOUNT_PREFIX_RE =
  /^\s*(?:ca\.?\s*|approx\.?\s*|etwa\s*)?[\d¼½¾⅓⅔⅛⅜⅝⅞]+(?:[.,/]\s*\d+)*(?:\s*[-–]\s*[\d¼½¾⅓⅔⅛⅜⅝⅞]+(?:[.,/]\s*\d+)*)?(?:\s+\d+\s*\/\s*\d+)?/u;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Range of the leading amount (+ unit) within a segment, e.g. "2-3 EL" in
 * "2-3 EL Honig". Used so an alternative that INHERITS the primary's amount can
 * keep that amount un-muted on its own line. Returns null for text amounts
 * ("Eine Prise") or when the segment has no numeric amount.
 */
export function amountPrefixRange(
  segment: string,
  hasAmount: boolean,
  unitName: string | null,
): SourceRange | null {
  if (!hasAmount) return null;
  const m = AMOUNT_PREFIX_RE.exec(segment);
  if (!m || m[0].trim().length === 0) return null;
  let end = m[0].length;
  if (unitName) {
    const um = new RegExp(`^\\s*${escapeRegExp(unitName)}\\.?`, "iu").exec(
      segment.slice(end),
    );
    if (um) end += um[0].length;
  }
  return [0, end];
}

/**
 * Decompose a segment into categorised, gap-filled parts covering all of it:
 * the leading amount/unit → "amount", the located ingredient name → "name",
 * and everything else (separators, prep, parenthetical notes) → "note". Used to
 * colour the source highlight so the amount/unit and the name read in distinct
 * colours. `name` should be the SOURCE name (the span the alias replaced, when
 * matched) so it's found in the raw segment; when it isn't found, that text
 * just stays "note".
 */
export function decomposeSegment(
  segment: string,
  hasAmount: boolean,
  unitName: string | null,
  name: string | null,
  notes: string | null,
  /** Offset where the real content starts — i.e. after a leading connector
   *  ("oder 1 TL Backpulver"). The amount is detected from here so the alt's
   *  own "1 TL" is recognised; the connector prefix is classified as a gap. */
  contentStart = 0,
): HighlightPart[] {
  const marks: HighlightPart[] = [];
  const amountLocal = amountPrefixRange(
    segment.slice(contentStart),
    hasAmount,
    unitName,
  );
  const amount: SourceRange | null = amountLocal
    ? [contentStart + amountLocal[0], contentStart + amountLocal[1]]
    : null;
  if (amount) marks.push({ range: amount, kind: "amount" });
  const needle = name?.trim().toLowerCase() ?? "";
  if (needle.length > 0) {
    const from = amount ? amount[1] : contentStart;
    const idx = segment.toLowerCase().indexOf(needle, from);
    if (idx >= 0) marks.push({ range: [idx, idx + needle.length], kind: "name" });
  }
  marks.sort((a, b) => a.range[0] - b.range[0]);
  // Deterministic drop test: a word in the leftover gaps that appears in the
  // row's output (name + notes + unit) is kept; one that appears nowhere was
  // discarded (a connector like "oder", a stripped marker) → struck through.
  const outputText = `${name ?? ""} ${notes ?? ""} ${unitName ?? ""}`.toLowerCase();
  const parts: HighlightPart[] = [];
  let cursor = 0;
  const fillGap = (start: number, end: number) => {
    if (end <= start) return;
    classifyGap(segment, start, end, outputText, parts);
  };
  for (const m of marks) {
    fillGap(cursor, m.range[0]);
    parts.push(m);
    cursor = m.range[1];
  }
  fillGap(cursor, segment.length);
  return parts;
}

/** Word-aware classification of a leftover gap: word runs absent from the
 *  output are "dropped", everything else (notes words + punctuation/glue) is
 *  "note". Offsets are relative to the whole segment. */
function classifyGap(
  segment: string,
  start: number,
  end: number,
  outputText: string,
  parts: HighlightPart[],
): void {
  const text = segment.slice(start, end);
  const wordRe = /\p{L}[\p{L}\p{N}.\-/']*/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (s: number, e: number, kind: HighlightKind) => {
    if (e > s) parts.push({ range: [start + s, start + e], kind });
  };
  while ((m = wordRe.exec(text)) !== null) {
    push(last, m.index, "note"); // punctuation / whitespace glue
    const dropped = !outputText.includes(m[0].toLowerCase());
    push(m.index, m.index + m[0].length, dropped ? "dropped" : "note");
    last = m.index + m[0].length;
  }
  push(last, text.length, "note");
}

/**
 * Range of `note` as it appears toward the END of `segment` (a trailing prep
 * note like "diced" in "pancetta, diced"), including a leading ", " when
 * present so muting reads cleanly. Returns null when the note text isn't found.
 */
export function trailingNoteRange(
  segment: string,
  note: string,
): SourceRange | null {
  const needle = note.trim();
  if (needle.length === 0) return null;
  const idx = segment.toLowerCase().lastIndexOf(needle.toLowerCase());
  if (idx < 0) return null;
  let start = idx;
  const sep = /[\s,;]$/;
  while (start > 0 && sep.test(segment[start - 1])) start -= 1;
  return [start, idx + needle.length];
}
