import {
  findIngredientCandidates,
  MIN_AUTO_MATCH_SCORE,
  type CatalogBlockIndex,
  type IngredientCatalog,
} from "../../matching";
import type { Leaf } from "../render-notes";

export type MatchResult = {
  matched: boolean;
  ingredientId: number | null;
  /** Display name — the matched alias verbatim, or the name-region text on the
   *  no-match path. */
  name: string;
  canonicalName: string | null;
  /** The original source span the matched alias replaced, when it differs from
   *  the alias (e.g. "Zwiebeln" → alias "Zwiebel"). Null otherwise. */
  sourceName: string | null;
};

const EMPTY: MatchResult = {
  matched: false,
  ingredientId: null,
  name: "",
  canonicalName: null,
  sourceName: null,
};

/**
 * Run the catalog matcher over the segment's unconsumed leaves and mark the
 * matched ingredient leaves consumed (role "ingredient"). The matcher
 * (`matching.ts`) is reused unchanged: we build a `matchText` from the
 * remainder leaves, remember each leaf's offset into it, then walk the
 * matcher's returned candidate tokens (whose `raw` is exact source text) to map
 * `coveredCandidateTokens` back to our leaves. Mutates `leaves`.
 */
export function applyMatch(
  source: string,
  leaves: Leaf[],
  catalog: IngredientCatalog,
  opts: { index?: CatalogBlockIndex; threshold?: number } = {},
): MatchResult {
  const remainder = leaves.filter((l) => !l.consumed);
  let matchText = "";
  const leafRange: { leaf: Leaf; s: number; e: number }[] = [];
  let prevEnd = -1;
  for (const lf of remainder) {
    if (matchText.length > 0) {
      const gap = prevEnd >= 0 ? source.slice(prevEnd, lf.start) : "";
      if (gap.length > 0) matchText += " ";
    }
    const s = matchText.length;
    matchText += lf.text;
    leafRange.push({ leaf: lf, s, e: matchText.length });
    prevEnd = lf.end;
  }
  if (matchText.trim().length === 0) return EMPTY;

  const { matches, candidate } = findIngredientCandidates(
    matchText,
    catalog,
    opts.index ? { index: opts.index } : undefined,
  );
  const threshold = opts.threshold ?? MIN_AUTO_MATCH_SCORE;
  const best = matches[0];
  if (!best || best.score < threshold) return noMatch(source, remainder);

  const covered = new Set(best.coveredCandidateTokens);
  let cursor = 0;
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = -1;
  for (let ti = 0; ti < candidate.length; ti++) {
    const raw = candidate[ti].raw;
    const at = matchText.indexOf(raw, cursor);
    if (at < 0) continue;
    const cs = at;
    const ce = at + raw.length;
    cursor = ce;
    if (!covered.has(ti)) continue;
    for (const lr of leafRange) {
      if (lr.s < ce && lr.e > cs) {
        lr.leaf.consumed = true;
        lr.leaf.role = "ingredient";
      }
    }
    minStart = Math.min(minStart, cs);
    maxEnd = Math.max(maxEnd, ce);
  }

  const name = best.displayName ?? best.aliasName;
  let sourceName: string | null = null;
  if (maxEnd > 0) {
    const span = matchText.slice(minStart, maxEnd).trim();
    if (span.length > 0 && span.toLowerCase() !== name.toLowerCase()) sourceName = span;
  }
  return {
    matched: true,
    ingredientId: best.ingredientId,
    name,
    canonicalName: best.canonicalName,
    sourceName,
  };
}

/** No catalog hit: the name is the depth-0 run up to the first top-level comma;
 *  the rest stays as notes. (Vocab-tail stripping is handled in a later pass.) */
function noMatch(source: string, remainder: Leaf[]): MatchResult {
  const nameLeaves: Leaf[] = [];
  for (const lf of remainder) {
    if (lf.kind === "comma" && lf.depth === 0) break;
    if (lf.depth > 0 || lf.kind === "open" || lf.kind === "close") break;
    nameLeaves.push(lf);
  }
  if (nameLeaves.length === 0) return EMPTY;
  for (const lf of nameLeaves) {
    lf.consumed = true;
    lf.role = "ingredient";
  }
  const name = source
    .slice(nameLeaves[0].start, nameLeaves[nameLeaves.length - 1].end)
    .trim();
  return { matched: false, ingredientId: null, name, canonicalName: null, sourceName: null };
}
