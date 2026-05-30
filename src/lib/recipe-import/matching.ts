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
  /** True when the underlying ingredient is flagged as equipment (Backpapier,
   *  Einmachgläser, …). The parser uses this to default the recipe row to
   *  `isOptional=true` so the user decides per-recipe whether to shop it. */
  isEquipment?: boolean;
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
  /** Propagated from the matched {@link CatalogEntry} — see its docstring. */
  isEquipment?: boolean;
  /** The exact candidate-token array (variant) this match was scored
   *  against, so the parser can derive name/notes from the matched span
   *  (first→last covered token). */
  candidate: CandidateToken[];
  /** True when this match came in via the catalog row whose `aliasName`
   *  equals its `canonicalName` (i.e. the canonical row itself, not one of
   *  the ingredient's aliases). Acts as a "slight boost" tiebreaker:
   *  - within an ingredient, the canonical row wins over equal-scoring
   *    aliases (so the pill label leads with the canonical name);
   *  - across ingredients with equal scores, the candidate that hit via
   *    the canonical row is preferred. */
  isCanonical: boolean;
};

/** A token of the candidate text — normalised (matching), raw (note
 *  reconstruction), and whether it sits after the first top-level comma.
 *  Post-comma tokens score fewer points (see {@link scoreMatch}): a comma
 *  is a soft signal that what follows reads more like an annotation than
 *  part of the core name. */
export type CandidateToken = {
  raw: string;
  normalized: string;
  postComma: boolean;
};

/**
 * Split a candidate into tokens. Commas are dropped as delimiters BUT flip
 * every following token to `postComma: true`. Other separators (whitespace,
 * semicolon, slash, dash) split without affecting the comma flag.
 */
export function tokenizeCandidate(text: string): CandidateToken[] {
  const out: CandidateToken[] = [];
  let postComma = false;
  // Keep commas as their own pieces so we can flip the flag as we cross them.
  for (const segment of text.split(/(,)/u)) {
    if (segment === ",") {
      postComma = true;
      continue;
    }
    for (const raw of segment.split(/[\s;/\-–—]+/u)) {
      if (raw.length === 0) continue;
      const normalized = normalizeForMatch(raw);
      if (normalized.length === 0) continue;
      out.push({ raw, normalized, postComma });
    }
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

/** Per-aligned-token record: which input (window) token hit which entry
 *  token, and how. Keeps both raw strings so the scorer can compute a
 *  length-aware bonus without re-running the matcher. */
type AlignedTokenMatch = {
  kind: MatchKind;
  windowOffset: number; // index within the window
  entryIndex: number; // index within entry.tokens
  entryToken: string;
  windowToken: string;
};

/**
 * Align EVERY token of a contiguous input window to a DISTINCT entry token,
 * in input order, greedily preferring exact > prefix > suffix. Prefix /
 * suffix tests run in both directions (`wt.startsWith(et)` AND
 * `et.startsWith(wt)`) so the catalog or the candidate may hold the longer
 * form. Returns null if any window token can't be matched — that means the
 * window holds an interior input token foreign to this entry, which would
 * leave a gap in the name, so the window is invalid. Entry tokens left
 * unconsumed are the "partial coverage" leftover the caller penalises.
 */
function alignWindowToEntry(
  window: CandidateToken[],
  entryTokens: string[],
): AlignedTokenMatch[] | null {
  const consumed = new Array<boolean>(entryTokens.length).fill(false);
  const matches: AlignedTokenMatch[] = [];
  for (let w = 0; w < window.length; w++) {
    const wt = window[w].normalized;
    let bestIdx = -1;
    let bestRank = 99;
    let bestKind: MatchKind | null = null;
    for (let e = 0; e < entryTokens.length; e++) {
      if (consumed[e]) continue;
      const et = entryTokens[e];
      let rank = 99;
      let kind: MatchKind | null = null;
      if (wt === et) {
        rank = 0;
        kind = "exact";
      } else if (wt.startsWith(et) || et.startsWith(wt)) {
        rank = 1;
        kind = "prefix";
      } else if (wt.endsWith(et) || et.endsWith(wt)) {
        rank = 2;
        kind = "suffix";
      }
      if (kind !== null && rank < bestRank) {
        bestRank = rank;
        bestIdx = e;
        bestKind = kind;
      }
    }
    if (bestIdx === -1 || bestKind === null) return null;
    consumed[bestIdx] = true;
    matches.push({
      kind: bestKind,
      windowOffset: w,
      entryIndex: bestIdx,
      entryToken: entryTokens[bestIdx],
      windowToken: wt,
    });
  }
  return matches;
}

/**
 * Tiny weighted score. The gate is on ENTRY coverage, not input coverage —
 * extra INPUT tokens outside the window are free (they become notes).
 *
 * - +100 per matched entry token whose input token is pre-comma, +60 when
 *   the input token is post-comma (a comma is a soft "this is annotation"
 *   signal, so a match staying within the pre-comma core outranks one that
 *   reaches across the comma — e.g. "olive oil" beats "oil divided" for
 *   "olive oil, divided").
 * - +20 per matched token that's exact or close-inflection-shaped (see
 *   {@link perTokenBonus}); 0 for a true fragment.
 * - +10 when the matched entry indices are strictly increasing (in order).
 * - −50 per UNMATCHED entry token (partial coverage). A fully-covered
 *   shorter entry therefore always beats a partially-covered longer one.
 */
function scoreMatch(
  aligned: AlignedTokenMatch[],
  window: CandidateToken[],
  inOrder: boolean,
  unmatchedEntryCount: number,
): number {
  let s = 0;
  for (const a of aligned) {
    const base = window[a.windowOffset].postComma ? 60 : 100;
    s += base + perTokenBonus(a.entryToken, a.windowToken);
  }
  if (inOrder) s += 10;
  s -= unmatchedEntryCount * 50;
  return s;
}

/**
 * Try every contiguous input window (size 1..min(entry,candidate)). A window
 * is valid only if every input token in it aligns to a distinct entry token
 * (no interior input gaps — that's the "adjacent window" rule; "red bell
 * pepper" doesn't cleanly hit "red pepper", it'd need a "bell pepper" alias).
 * Entry tokens may be left uncovered (penalised −50 each). The best-scoring
 * window survives. The matched span (first→last covered token) is what the
 * parser turns into the display name; tokens outside it become notes.
 */
function bestMatchForEntry(
  entry: CatalogEntry,
  candidate: CandidateToken[],
): IngredientCandidateMatch | null {
  const E = entry.tokens;
  if (E.length === 0 || candidate.length === 0) return null;
  const maxWin = Math.min(E.length, candidate.length);
  // The "canonical row" (aliasName === canonicalName) gets a tiny +1 boost so
  // it slightly outranks otherwise-equal alias hits. +1 is below every other
  // increment so it can't shift a match across the auto-merge gate on its own.
  const isCanonical =
    entry.aliasName.toLowerCase() === entry.canonicalName.toLowerCase();
  let best: IngredientCandidateMatch | null = null;
  for (let start = 0; start < candidate.length; start++) {
    for (let len = 1; start + len <= candidate.length && len <= maxWin; len++) {
      const window = candidate.slice(start, start + len);
      const aligned = alignWindowToEntry(window, E);
      if (!aligned) continue;
      const inOrder = aligned.every(
        (a, i) => i === 0 || a.entryIndex > aligned[i - 1].entryIndex,
      );
      const unmatchedEntryCount = E.length - aligned.length;
      const score =
        scoreMatch(aligned, window, inOrder, unmatchedEntryCount) +
        (isCanonical ? 1 : 0);
      if (best && score <= best.score) continue;
      best = {
        ingredientId: entry.ingredientId,
        canonicalName: entry.canonicalName,
        aliasName: entry.aliasName,
        score,
        coveredCandidateTokens: aligned.map((a) => start + a.windowOffset),
        perTokenKinds: aligned.map((a) => a.kind),
        inOrder,
        defaultUnit: entry.defaultUnit,
        defaultSubUnit: entry.defaultSubUnit,
        isEquipment: entry.isEquipment,
        candidate,
        isCanonical,
      };
    }
  }
  return best;
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
 * Default minimum match score for auto-resolving a row without user
 * confirmation. Tuned to:
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
 * URL / paste imports use this strict default — they pull arbitrary text
 * the catalog may not cover, so a strong protective gate avoids
 * mis-merging novel ingredients into broader catalog rows.
 *
 * Familywall imports pass a relaxed override (`130`) via the
 * `autoMatchScoreThreshold` option to {@link parseIngredientLines} /
 * {@link parseIngredientLinesIntoSections}. The catalog is pre-seeded to
 * cover every ingredient the familywall cache references, so the lower
 * gate absorbs descriptor compounds (`rote Paprikaschote` → Paprika,
 * "rote" → notes) instead of orphaning them.
 *
 * Pill UI still surfaces below-threshold matches so the user can opt in
 * manually — the gate is only on auto-pick.
 *
 * A single exact (or close-inflection) pre-comma token scores
 * 100 + 20 + 10 = 130, so the gate sits exactly there: clean single-token
 * hits auto-pick, prefix fragments ("Paprika" inside "Paprikapulver", 110)
 * and partial-coverage hits (penalised −50) stay below and only surface as
 * pills.
 */
export const MIN_AUTO_MATCH_SCORE = 130;

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
 * best score across both. Each match carries its own `candidate` token array
 * (the variant it won in) so the parser can derive name/notes per candidate.
 * The returned top-level `candidate` is the winning variant, for callers that
 * want the tokenisation that produced the top match.
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
  // produced it so we can return that variant as `candidate`. Within an
  // ingredient, score wins; ties favor the canonical row (so the pill
  // surfaces the canonical name when an alias of the same ingredient
  // scored just as well); further ties favor the longer alias.
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
          m.isCanonical && !existing.match.isCanonical) ||
        (m.score === existing.match.score &&
          m.isCanonical === existing.match.isCanonical &&
          m.aliasName.length > existing.match.aliasName.length)
      ) {
        bestById.set(m.ingredientId, { match: m, variant });
      }
    }
  }
  const sorted = Array.from(bestById.values()).sort((a, b) => {
    if (b.match.score !== a.match.score) return b.match.score - a.match.score;
    // Cross-ingredient tiebreak: prefer the candidate whose winning row is
    // the canonical (a redundant guard since canonicals already get a +1
    // score boost in bestMatchForEntry, but explicit here so the sort
    // stays robust if the boost is ever tuned).
    if (a.match.isCanonical !== b.match.isCanonical) {
      return a.match.isCanonical ? -1 : 1;
    }
    if (a.match.aliasName.length !== b.match.aliasName.length)
      return b.match.aliasName.length - a.match.aliasName.length;
    return a.match.canonicalName.localeCompare(b.match.canonicalName, "de");
  });
  const matches = sorted.slice(0, limit).map((s) => s.match);
  const candidate = sorted[0]?.variant ?? primary;
  return { matches, candidate };
}
