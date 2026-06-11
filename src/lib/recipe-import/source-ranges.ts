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
