import { canonicalizeMatchToken, normalizeForMatch } from "../ingredient";
import type { CandidateToken } from "../matching";
import type { Leaf } from "./render-notes";

/** A matcher candidate token projected from the AST leaves, carrying the leaf
 *  index range it was built from so a match's covered tokens map straight back
 *  to source leaves (no raw-text walk). */
export type AstCandidateToken = CandidateToken & {
  /** Inclusive leaf index range [leafStart, leafEnd] this token spans. */
  leafStart: number;
  leafEnd: number;
};

const isSep = (k: Leaf["kind"]): boolean =>
  k === "slash" || k === "semicolon" || k === "dash";

// Separator → the joinedByDash string the matcher records. Slash/semicolon are
// padded; a dash carries its own glyph. Higher value = higher precedence
// (semicolon beats slash beats dash), mirroring tokenizeCandidate's leadingSep.
const sepString = (lf: Leaf): string =>
  lf.kind === "semicolon" ? "; " : lf.kind === "slash" ? " / " : lf.text;
const sepRank = (s: string): number => (s === "; " ? 3 : s === " / " ? 2 : 1);

/**
 * Project AST leaves to matcher candidate tokens — the single tokenization the
 * matcher consumes. Reproduces {@link tokenizeCandidate} (joinDashes=false) and
 * {@link tokenizeCandidateJoinDashes} (joinDashes=true):
 *  - commas are delimiters (set postComma cumulatively, precededByComma on the
 *    next token); they never appear in a token;
 *  - a content run between separators becomes one token (parens/dots stay in
 *    `raw`, are dropped only from `normalized`); `inParens` if any leaf is
 *    inside parens;
 *  - slash/semicolon/intra-word dash split for matching but are remembered as
 *    `joinedByDash` on the next token (verbatim-note reconstruction);
 *  - joinDashes keeps an intra-letter dash inside the token (normalized drops
 *    it) so "Paprika-Pulver" aligns to "Paprikapulver".
 */
export function leavesToCandidateTokens(
  leaves: readonly Leaf[],
  joinDashes: boolean,
): AstCandidateToken[] {
  const out: AstCandidateToken[] = [];
  let postComma = false;
  let pendingComma = false;
  let pendingSep: string | undefined;
  let emitted = false;

  let raw = "";
  let startIdx = -1;
  let endIdx = -1;
  let inParens = false;

  const flush = (): void => {
    // Nothing accumulated → keep `pendingSep` so a slash/semicolon survives the
    // whitespace before the next token (matches tokenizeCandidate's per-segment
    // pending flag).
    if (startIdx < 0) return;
    const forMatch = joinDashes ? raw.replace(/(\p{L})[-–—](\p{L})/gu, "$1$2") : raw;
    const normalized = canonicalizeMatchToken(normalizeForMatch(forMatch));
    if (normalized.length > 0) {
      const sep = pendingComma ? undefined : pendingSep;
      out.push({
        raw,
        normalized,
        postComma,
        precededByComma: pendingComma,
        inParens,
        ...(sep !== undefined ? { joinedByDash: sep } : {}),
        leafStart: startIdx,
        leafEnd: endIdx,
      });
      pendingComma = false;
      emitted = true;
      pendingSep = undefined; // consumed by this token
    }
    raw = "";
    startIdx = -1;
    endIdx = -1;
    inParens = false;
  };

  // The join-dashes variant records NO joinedByDash (it drops slashes entirely);
  // only the primary variant remembers separators.
  const setSep = (s: string): void => {
    if (joinDashes || pendingComma) return;
    if (pendingSep === undefined || sepRank(s) > sepRank(pendingSep)) pendingSep = s;
  };

  for (let i = 0; i < leaves.length; i++) {
    const lf = leaves[i];
    const prev = leaves[i - 1];
    const gap = prev ? lf.start > prev.end : false;

    if (lf.kind === "comma") {
      flush();
      postComma = true;
      pendingComma = true;
      pendingSep = undefined;
      emitted = false;
      continue;
    }
    if (gap) {
      // Whitespace ends the current content run (a pending slash/semicolon
      // separator persists to the next token, like tokenizeCandidate).
      flush();
      emitted = false;
    }
    if (lf.kind === "dash") {
      // join-dashes never splits on a dash — it stays in the token's raw and is
      // dropped from `normalized` only for letter-dash-letter (handled in flush).
      if (joinDashes) {
        if (startIdx < 0) startIdx = i;
        raw += lf.text;
        endIdx = i;
        if (lf.depth > 0) inParens = true;
        continue;
      }
      // primary: a dash adjacent to the current run (intra-word) splits but is
      // remembered; a spaced/leading dash is dropped.
      const adjacent = startIdx >= 0 && !gap && prev && lf.start === prev.end;
      flush();
      if (adjacent && emitted) setSep(lf.text);
      continue;
    }
    if (isSep(lf.kind)) {
      flush();
      setSep(sepString(lf));
      continue;
    }
    // Content leaf: word / number / punct / open / close.
    if (startIdx < 0) startIdx = i;
    raw += lf.text;
    endIdx = i;
    if (lf.depth > 0 || lf.kind === "open") inParens = true;
  }
  flush();
  return out;
}
