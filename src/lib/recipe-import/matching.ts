/**
 * Substring-style ingredient matching. Given a candidate text (the name area
 * after quantity / unit / parens have been pulled out), find every catalog
 * entry whose tokens line up as a window inside the candidate's tokens, and
 * rank them.
 *
 * Design choices (see also the design discussion in chat / docs):
 *   - Tokenise both sides on whitespace + comma + semicolon + slash + dash.
 *     Commas become whitespace for matching purposes — the longest alias
 *     wins regardless of whether the recipe wrote `Paprikapulver,
 *     rosenscharf` or `Paprikapulver rosenscharf`.
 *   - Each entry token matches a candidate token via exact / prefix / suffix
 *     equality. Prefix/suffix is checked in BOTH directions — `et.startsWith
 *     (wt)` as well as `wt.startsWith(et)` — so the matcher works whether
 *     the catalog or the candidate happens to hold the longer form. No
 *     mid-token substring matching: that kept "Ei" out of "Reis" without
 *     giving up German compound-noun matching like "Brot" in "Vollkornbrot".
 *   - The entry's tokens must form a contiguous window in the candidate.
 *     Permutation within the window is allowed (out-of-order is still a
 *     valid match) but loses the in-order ranking bonus.
 *   - Per-token bonus is length-aware: an exact match scores the same as a
 *     "close inflection" (≥75% length overlap, both tokens ≥4 chars), while
 *     a true fragment (Paprika inside Paprikapulver) gets no bonus and stays
 *     below the auto-match threshold. This is the mechanism that lets
 *     "Paprikaschote" and "Paprikaschoten" merge while keeping "Paprika"
 *     from collapsing "Paprikapulver Rosenscharf".
 *   - The +5 anchor bonus only fires when the entry covers the WHOLE
 *     candidate (window length equals candidate length AND starts at
 *     index 0). Without this, a 1-token entry hitting position 0 of a
 *     2-token candidate ("Paprikapulver" inside "Paprikapulver edelsüß")
 *     would earn enough bonus to clear the auto-merge gate and collapse
 *     distinct products into broader catalog entries.
 *   - The candidate is tokenised TWO ways and the matcher runs over both:
 *     once with dashes as a separator (so "Cherry Tomate" can still align
 *     against a 2-token "Cherry-Tomate" entry) and once with dashes between
 *     letters stripped (so "Paprika-Pulver" can match a 1-token
 *     "Paprikapulver" entry). The best score per ingredient survives across
 *     variants; when both variants tie, alias length breaks the tie.
 *   - Scoring is intentionally tiny — easy to reason about, easy to tweak.
 *     The full breakdown is in {@link scoreMatch} / {@link perTokenBonus}.
 */

import { normalizeForMatch } from "./ingredient.ts";

export type CatalogEntry = {
  /** The ingredient row this entry resolves to. */
  ingredientId: number;
  canonicalName: string;
  /** The exact text we're matching against (either the canonical name itself
   *  or an alias name). Surfaced so the caller can tell *why* an entry hit. */
  aliasName: string;
  /** Pre-tokenised + normalised form of `aliasName`. */
  tokens: string[];
  /** Per-alias defaults — flow through to the parser so a matched alias can
   *  still influence unit / sub-unit selection downstream. */
  defaultUnit?: { id: number; name: string };
  defaultSubUnit?: { id: number; name: string; perPurchase: number };
};

export type IngredientCatalog = CatalogEntry[];

export type MatchKind = "exact" | "prefix" | "suffix";

export type IngredientCandidateMatch = {
  ingredientId: number;
  canonicalName: string;
  /** The alias-or-canonical row that produced this match. */
  aliasName: string;
  score: number;
  /** Indices of candidate tokens that the entry tokens are anchored to,
   *  in entry-order. Used by the parser to compute leftover-tokens-as-notes
   *  and by the UI to highlight matched spans. */
  coveredCandidateTokens: number[];
  /** Per-entry-token match kind, ordered to match the entry tokens. */
  perTokenKinds: MatchKind[];
  inOrder: boolean;
  defaultUnit?: { id: number; name: string };
  defaultSubUnit?: { id: number; name: string; perPurchase: number };
};

/** A token of the candidate text — both the normalised form (used for
 *  matching) and the raw text (used for note reconstruction). */
export type CandidateToken = { raw: string; normalized: string };

/**
 * Punctuation that's allowed to split candidate tokens. Commas in
 * particular are treated as whitespace so the substring algorithm sees
 * `"Paprikapulver, rosenscharfes"` and `"Paprikapulver rosenscharfes"` the
 * same way.
 */
const TOKEN_SPLIT_RE = /[\s,;/\-–—]+/u;

export function tokenizeCandidate(text: string): CandidateToken[] {
  const out: CandidateToken[] = [];
  for (const raw of text.split(TOKEN_SPLIT_RE)) {
    if (raw.length === 0) continue;
    const normalized = normalizeForMatch(raw);
    if (normalized.length === 0) continue;
    out.push({ raw, normalized });
  }
  return out;
}

/**
 * Alternative tokenisation that strips dashes appearing between two letters
 * before splitting. Produced so the matcher can also see the compound-noun
 * reading of inputs like "Paprika-Pulver" (→ one token "paprikapulver") and
 * align them against catalog entries that store the closed form
 * ("Paprikapulver"). Returns the same shape as {@link tokenizeCandidate};
 * the caller decides whether the two forms produced the same tokens (in
 * which case it can skip the second matcher pass).
 */
export function tokenizeCandidateJoinDashes(text: string): CandidateToken[] {
  // Only collapse dashes that sit between two letters — leaves numeric
  // ranges ("200-300"), whitespace-padded notes dashes ("Salz - nach
  // Geschmack") and other punctuation patterns untouched.
  const joined = text.replace(/(\p{L})[-–—](\p{L})/gu, "$1$2");
  return tokenizeCandidate(joined);
}

function sameTokens(a: CandidateToken[], b: CandidateToken[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].normalized !== b[i].normalized) return false;
  }
  return true;
}

/**
 * Try every starting position in the candidate. For each one, take a window
 * of size `entry.tokens.length` and check whether the entry tokens form a
 * permutation of the window. The best hit (or null) is returned, with its
 * score and per-token kinds attached.
 */
function bestMatchForEntry(
  entry: CatalogEntry,
  candidate: CandidateToken[],
): IngredientCandidateMatch | null {
  if (entry.tokens.length === 0 || candidate.length < entry.tokens.length) {
    return null;
  }
  let best: IngredientCandidateMatch | null = null;
  for (let start = 0; start + entry.tokens.length <= candidate.length; start++) {
    const window = candidate.slice(start, start + entry.tokens.length);
    const aligned = alignEntryToWindow(entry.tokens, window);
    if (!aligned) continue;
    const coveredCandidateTokens = aligned.matches.map(
      (m) => start + m.windowIndex,
    );
    const perTokenKinds = aligned.matches.map((m) => m.kind);
    const inOrder = aligned.matches.every((m, i) => m.windowIndex === i);
    // The anchor bonus only fires when the entry covers the WHOLE candidate.
    // A 1-token entry hitting position 0 of a 2-token candidate
    // ("Paprikapulver" inside "Paprikapulver edelsüß", or "Bio" inside
    // "Bio-Honig") is a fragment-at-start, not a clean hit — without this
    // check it would earn the +5 that pushes 1-token exact matches over
    // the auto-merge threshold and accidentally collapse distinct
    // products into broader catalog entries.
    const fullCoverageFromStart =
      start === 0 && entry.tokens.length === candidate.length;
    const score = scoreMatch({
      matches: aligned.matches,
      inOrder,
      isFullCoverageFromStart: fullCoverageFromStart,
    });
    if (!best || score > best.score) {
      best = {
        ingredientId: entry.ingredientId,
        canonicalName: entry.canonicalName,
        aliasName: entry.aliasName,
        score,
        coveredCandidateTokens,
        perTokenKinds,
        inOrder,
        defaultUnit: entry.defaultUnit,
        defaultSubUnit: entry.defaultSubUnit,
      };
    }
  }
  return best;
}

/** Per-token alignment record: keeps both sides' raw strings so the scorer
 *  can compute a length-aware bonus without re-running the matcher. */
type AlignedTokenMatch = {
  kind: MatchKind;
  windowIndex: number;
  entryToken: string;
  windowToken: string;
};

/**
 * Greedy alignment: for each entry token in turn, find the first un-consumed
 * window token that matches (preferring exact > prefix > suffix). Prefix /
 * suffix tests run in both directions — `wt.startsWith(et)` AND
 * `et.startsWith(wt)` — so "Paprikaschoten" (catalog) still hits
 * "Paprikaschote" (candidate). Returns `null` if any entry token can't be
 * matched. This is good enough for the sizes we deal with (entry tokens ≤
 * ~5; window tokens equal in size).
 */
function alignEntryToWindow(
  entryTokens: string[],
  window: CandidateToken[],
): { matches: AlignedTokenMatch[] } | null {
  const consumed = new Array<boolean>(window.length).fill(false);
  const matches: AlignedTokenMatch[] = [];
  for (const et of entryTokens) {
    let bestIdx = -1;
    let bestKind: MatchKind | null = null;
    let bestWt = "";
    for (let i = 0; i < window.length; i++) {
      if (consumed[i]) continue;
      const wt = window[i].normalized;
      if (wt === et) {
        bestIdx = i;
        bestKind = "exact";
        bestWt = wt;
        break;
      }
      if (wt.startsWith(et) || et.startsWith(wt)) {
        if (bestKind !== "prefix") {
          bestIdx = i;
          bestKind = "prefix";
          bestWt = wt;
        }
        continue;
      }
      if ((wt.endsWith(et) || et.endsWith(wt)) && bestKind === null) {
        bestIdx = i;
        bestKind = "suffix";
        bestWt = wt;
      }
    }
    if (bestIdx === -1 || bestKind === null) return null;
    consumed[bestIdx] = true;
    matches.push({
      kind: bestKind,
      windowIndex: bestIdx,
      entryToken: et,
      windowToken: bestWt,
    });
  }
  return { matches };
}

/**
 * Tiny weighted score. Each contribution is independent so the weights are
 * easy to tweak without unraveling the algorithm.
 *
 * - Base coverage: 100 per matched token. Bigger aliases naturally win.
 * - Per-token bonus: see {@link perTokenBonus}. +20 for exact OR close-
 *   inflection-shaped prefix/suffix; 0 for "fragment" prefix/suffix.
 * - In-order bonus: +10 if the entry tokens line up with the window in the
 *   same order (so "Paprikapulver rosenscharf" beats "rosenscharf
 *   Paprikapulver" at equal token count).
 * - Full-coverage anchor bonus: +5 when the entry covers the entire
 *   candidate (window starts at index 0 AND entry token count equals
 *   candidate token count). This is the difference between "the candidate
 *   IS this entry" and "this entry is a fragment of the candidate".
 */
function scoreMatch({
  matches,
  inOrder,
  isFullCoverageFromStart,
}: {
  matches: AlignedTokenMatch[];
  inOrder: boolean;
  isFullCoverageFromStart: boolean;
}): number {
  let s = matches.length * 100;
  for (const m of matches) {
    s += perTokenBonus(m.entryToken, m.windowToken);
  }
  if (inOrder) s += 10;
  if (isFullCoverageFromStart) s += 5;
  return s;
}

/**
 * Per-token bonus. Returns +20 when the two tokens are either identical or
 * close enough in shape to read as the same word ("Paprikaschote" vs
 * "Paprikaschoten"); 0 otherwise.
 *
 * "Close enough" = length ratio (shorter / longer) ≥ 0.75 AND both tokens
 * at least 4 characters. The min-length floor is what stops short-word
 * inflections like "Ei" / "Eis" (ratio 0.67, too low anyway) and "Tee" /
 * "Tees" (ratio 0.75 but min length 3) from auto-merging — those ambiguous
 * shapes still surface as pills, just not as auto-picks.
 *
 * Cases the cutoff is calibrated to:
 *   - "Paprika" / "Paprikapulver" (7/13 = 0.54) → 0, stays a fragment
 *   - "Brot" / "Vollkornbrot" (4/12 = 0.33) → 0, stays a fragment
 *   - "Paprikaschote" / "Paprikaschoten" (13/14 = 0.93) → +20, merges
 *   - "Salz" / "Salze" (4/5 = 0.80) → +20, merges
 */
function perTokenBonus(et: string, wt: string): number {
  if (et === wt) return 20;
  const minLen = Math.min(et.length, wt.length);
  const maxLen = Math.max(et.length, wt.length);
  if (minLen >= 4 && minLen / maxLen >= 0.75) return 20;
  return 0;
}

/**
 * Minimum match score at which the parser is allowed to auto-resolve a row
 * without user confirmation. Tuned to:
 *   - accept full-coverage single-token exact matches (`Paprika` → `Paprika`: 135)
 *   - accept full-coverage close-inflection matches
 *     (`Paprikaschote` ↔ `Paprikaschoten`: 135 — see {@link perTokenBonus})
 *   - reject 1-token "fragment-at-start" matches that would merge distinct
 *     products into a broader catalog entry (`Paprikapulver` inside
 *     `Paprikapulver edelsüß`: 130 — exact token but the entry doesn't
 *     cover the full candidate, so no anchor bonus)
 *   - reject single-token prefix-only matches against longer candidates
 *     (`Paprika` in catalog matching `Paprikapulver Rosenscharf`: 110)
 *   - reject not-anchored single-token exact matches that would mis-resolve
 *     compound nouns (`Tomate` inside `Cherry-Tomate`: 130).
 *
 * Pill UI still surfaces below-threshold matches so the user can opt in
 * manually — the gate is only on auto-pick.
 */
export const MIN_AUTO_MATCH_SCORE = 135;

export type FindCandidatesOptions = {
  /** Cap on returned matches. Defaults to 5. */
  limit?: number;
};

/**
 * Run the matcher over the full catalog. Best score per ingredient survives;
 * ties broken by alias-name length (longer first), then by alphabetical
 * order. Returns at most `limit` matches.
 *
 * The candidate text is tokenised twice (see {@link tokenizeCandidateJoinDashes})
 * and the matcher runs over each variant; the per-ingredient dedup keeps the
 * best score across both. The returned `candidate` is the tokenisation that
 * produced the top match — so `uncoveredTokens(candidate, matches[0])` still
 * yields the right leftover tokens regardless of which variant won.
 */
export function findIngredientCandidates(
  candidateText: string,
  catalog: IngredientCatalog,
  options: FindCandidatesOptions = {},
): { matches: IngredientCandidateMatch[]; candidate: CandidateToken[] } {
  const primary = tokenizeCandidate(candidateText);
  if (primary.length === 0) return { matches: [], candidate: primary };
  const joined = tokenizeCandidateJoinDashes(candidateText);
  const variants: CandidateToken[][] =
    joined.length > 0 && !sameTokens(primary, joined)
      ? [primary, joined]
      : [primary];
  const limit = options.limit ?? 5;

  // One best entry per ingredient id, plus a remember of which variant
  // produced it so we can return that variant as `candidate`.
  const bestById = new Map<
    number,
    { match: IngredientCandidateMatch; variant: CandidateToken[] }
  >();
  for (const variant of variants) {
    for (const entry of catalog) {
      const m = bestMatchForEntry(entry, variant);
      if (!m) continue;
      const existing = bestById.get(m.ingredientId);
      if (
        !existing ||
        m.score > existing.match.score ||
        (m.score === existing.match.score &&
          m.aliasName.length > existing.match.aliasName.length)
      ) {
        bestById.set(m.ingredientId, { match: m, variant });
      }
    }
  }
  const sorted = Array.from(bestById.values()).sort((a, b) => {
    if (b.match.score !== a.match.score) return b.match.score - a.match.score;
    if (a.match.aliasName.length !== b.match.aliasName.length)
      return b.match.aliasName.length - a.match.aliasName.length;
    return a.match.canonicalName.localeCompare(b.match.canonicalName, "de");
  });
  const matches = sorted.slice(0, limit).map((s) => s.match);
  const candidate = sorted[0]?.variant ?? primary;
  return { matches, candidate };
}

/**
 * Helper for the parser: given a winning match, return the candidate tokens
 * NOT covered by the match — the parser folds them back into the row's
 * notes alongside any pre-extracted bracket / paren content.
 */
export function uncoveredTokens(
  candidate: CandidateToken[],
  match: IngredientCandidateMatch,
): CandidateToken[] {
  const covered = new Set(match.coveredCandidateTokens);
  return candidate.filter((_, i) => !covered.has(i));
}

/** Rebuild a "notes" string from the uncovered raw tokens, preserving
 *  the source's spelling. */
export function tokensToNotes(tokens: CandidateToken[]): string {
  return tokens.map((t) => t.raw).join(" ").trim();
}
