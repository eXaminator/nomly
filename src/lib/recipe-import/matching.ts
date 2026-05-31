/**
 * Structural ingredient matching. Given a candidate text (the name area +
 * comma-tail), find every catalog entry whose tokens line up as a contiguous
 * window inside the candidate's tokens, and rank them. Name/notes derivation
 * (the matched catalog alias becomes the name, every uncovered input token
 * becomes notes) lives in the parser; this module reports which candidate
 * tokens a match covered ({@link IngredientCandidateMatch.coveredCandidateTokens}).
 * It is purely structural — NO prep/descriptor word-lists.
 *
 * Design choices:
 *   - Gate on LOOKUP coverage, not input coverage. Extra INPUT tokens outside
 *     the matched window are free (the parser turns them into notes), so
 *     "Salt divided" still matches "Salt". A catalog entry, by contrast, wants
 *     (near-)full coverage: unmatched entry tokens are penalised −120 each
 *     (one matched token's worth), so a fully-covered shorter entry ("Tomate"
 *     for "Tomaten") beats a partially-covered longer one even when the longer
 *     one matched more input tokens ("oat cooking cream" loses to "oats" for
 *     "quick cooking oats"). Identity lives in
 *     the catalog: seed "Cherry Tomate" as its own entry and it wins by token
 *     count.
 *   - "Adjacent window": every INPUT token inside the matched window must
 *     align to a distinct entry token (no interior input gaps), so the name
 *     span stays clean. "red bell pepper" therefore does NOT cleanly hit
 *     "red pepper" — seed "bell pepper" as an alias instead.
 *   - Each entry token matches via exact / prefix / suffix equality, checked
 *     in BOTH directions, so the catalog or the candidate may hold the longer
 *     form. No mid-token substring matching ("Ei" stays out of "Reis").
 *   - Per-token bonus is length-aware: exact or "close inflection" (≥75%
 *     length overlap, both ≥4 chars) earns +20; a true fragment ("Paprika"
 *     inside "Paprikapulver") earns 0 and stays below the gate. This is what
 *     keeps fragment hits from auto-merging while "Paprikaschote" ↔
 *     "Paprikaschoten" still merge.
 *   - Post-comma INPUT tokens score 60 instead of 100 — a comma is a soft
 *     "this is annotation" signal, so a match staying within the pre-comma
 *     core ("olive oil") outranks one reaching across the comma to a polluted
 *     "oil divided" entry.
 *   - The candidate is tokenised TWO ways: the primary split (dashes split,
 *     so "Cherry-Tomate" aligns against a 2-token "Cherry-Tomate" entry) and
 *     a join-dashes variant (intra-letter dashes kept in one token, normalised
 *     away, so "Paprika-Pulver" aligns against closed "Paprikapulver"). Best
 *     score per ingredient survives; ties break on alias length. (The display
 *     name comes from the matched alias, so neither variant's raw spelling
 *     leaks into it.)
 *   - Scoring is intentionally tiny — see {@link scoreMatch} /
 *     {@link perTokenBonus}.
 */

import { canonicalizeMatchToken, normalizeForMatch } from "./ingredient.ts";

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
  /** True for every token after the first top-level comma (cumulative) —
   *  drives the post-comma score discount. */
  postComma: boolean;
  /** True only for the token IMMEDIATELY following a comma delimiter — lets
   *  the parser re-insert internal commas in a name when the matched alias
   *  itself contains one. */
  precededByComma: boolean;
};

/**
 * Split a candidate into tokens. Commas are dropped as delimiters BUT flip
 * every following token to `postComma: true` (and mark the immediately-next
 * token `precededByComma: true`). Other separators (whitespace, semicolon,
 * slash, dash) split without affecting the comma flags.
 */
export function tokenizeCandidate(text: string): CandidateToken[] {
  const out: CandidateToken[] = [];
  let postComma = false;
  let pendingComma = false;
  // Keep commas as their own pieces so we can flip the flags as we cross them.
  for (const segment of text.split(/(,)/u)) {
    if (segment === ",") {
      postComma = true;
      pendingComma = true;
      continue;
    }
    for (const raw of segment.split(/[\s;/\-–—]+/u)) {
      if (raw.length === 0) continue;
      const normalized = canonicalizeMatchToken(normalizeForMatch(raw));
      if (normalized.length === 0) continue;
      out.push({ raw, normalized, postComma, precededByComma: pendingComma });
      pendingComma = false;
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
  // Do NOT split on intra-letter dashes here: keep "Paprika-Pulver" as one
  // token so it can align against a closed-form catalog entry
  // ("Paprikapulver"). Only `normalized` drops the dash for matching; `raw` is
  // retained for note reconstruction (the display name comes from the alias).
  const out: CandidateToken[] = [];
  let postComma = false;
  let pendingComma = false;
  for (const segment of text.split(/(,)/u)) {
    if (segment === ",") {
      postComma = true;
      pendingComma = true;
      continue;
    }
    // Split on whitespace / semicolon / slash, but not on dashes between
    // letters. Standalone / padded dashes still separate (handled by the
    // surrounding whitespace).
    for (const raw of segment.split(/[\s;/]+/u)) {
      if (raw.length === 0) continue;
      const normalized = canonicalizeMatchToken(
        normalizeForMatch(raw.replace(/(\p{L})[-–—](\p{L})/gu, "$1$2")),
      );
      if (normalized.length === 0) continue;
      out.push({ raw, normalized, postComma, precededByComma: pendingComma });
      pendingComma = false;
    }
  }
  return out;
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
      // Non-exact (prefix/suffix) alignment requires the SHORTER token to be
      // at least 3 chars. Without this floor a 2-char stopword tail-matches a
      // long entry token — "to" suffix-matches "risotto", covering the whole
      // "risotto rice" entry so "rice to serve" mis-resolves to it instead of
      // plain "rice". Exact matches are exempt (any length).
      const okFragment = Math.min(wt.length, et.length) >= 3;
      if (wt === et) {
        rank = 0;
        kind = "exact";
      } else if (okFragment && (wt.startsWith(et) || et.startsWith(wt))) {
        rank = 1;
        kind = "prefix";
      } else if (okFragment && (wt.endsWith(et) || et.endsWith(wt))) {
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
 * - −120 per UNMATCHED entry token (partial coverage) — one matched token's
 *   worth (100 base + 20 bonus), so each token an entry leaves uncovered
 *   cancels a token it did match. A fully-covered shorter entry therefore
 *   beats a partially-covered longer one even when the latter matched more
 *   input tokens (it scores by NET covered-minus-uncovered token value).
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
  s -= unmatchedEntryCount * 120;
  return s;
}

/**
 * Try every contiguous input window (size 1..min(entry,candidate)). A window
 * is valid only if every input token in it aligns to a distinct entry token
 * (no interior input gaps — that's the "adjacent window" rule; "red bell
 * pepper" doesn't cleanly hit "red pepper", it'd need a "bell pepper" alias).
 * Entry tokens may be left uncovered (penalised −120 each). The best-scoring
 * window survives. Its covered candidate tokens tell the parser which input is
 * "used up" by the alias; the alias becomes the display name and every
 * uncovered input token becomes notes.
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
 * at least 4 characters AND the absolute length gap is at most 2. An
 * inflectional ending is short ("-n", "-en", "-er", "-es"); a whole-word
 * compound head ("…mehl", "…pulver") is not. The ratio alone is fooled by a
 * long stem with a compound suffix — "Kichererbsen" / "Kichererbsenmehl"
 * (12/16 = 0.75) would otherwise read as one word and tie with the exact
 * "Kichererbsen" match. The min-length floor stops short-word inflections
 * like "Ei" / "Eis" and "Tee" / "Tees" from auto-merging — those ambiguous
 * shapes still surface as pills, just not as auto-picks.
 *
 * Cases the cutoff is calibrated to:
 *   - "Paprika" / "Paprikapulver" (Δ6) → 0, stays a fragment
 *   - "Brot" / "Vollkornbrot" (Δ8) → 0, stays a fragment
 *   - "Kichererbsen" / "Kichererbsenmehl" (Δ4) → 0, stays a fragment
 *   - "Paprikaschote" / "Paprikaschoten" (Δ1, 13/14 = 0.93) → +20, merges
 *   - "Salz" / "Salze" (Δ1, 4/5 = 0.80) → +20, merges
 */
function perTokenBonus(et: string, wt: string): number {
  if (et === wt) return 20;
  const minLen = Math.min(et.length, wt.length);
  const maxLen = Math.max(et.length, wt.length);
  if (minLen >= 4 && maxLen - minLen <= 2 && minLen / maxLen >= 0.75) return 20;
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
 * and partial-coverage hits (penalised −120) stay below and only surface as
 * pills.
 */
export const MIN_AUTO_MATCH_SCORE = 130;

export type FindCandidatesOptions = {
  /** Cap on returned matches. Defaults to 5. */
  limit?: number;
};

/**
 * How well a per-ingredient match reproduces the input's SURFACE form. Breaks
 * ties between an ingredient's canonical row and its aliases so a verbatim,
 * explicitly-registered alias the user typed wins over the canonical instead of
 * being shadowed by it:
 *   - input "Äpfel" keeps alias "Äpfel" (not canonical "Apfel" — both fold to
 *     "apfel" once diacritics are stripped, so they tie on the structural score)
 *   - input "Zwiebeln" keeps alias "Zwiebeln" (not the canonical "Zwiebel",
 *     which only matches as a close-inflection prefix)
 *
 *   2 = all-exact coverage AND the alias's raw spelling equals the matched span
 *   1 = all-exact coverage on normalised tokens (diacritics/case folded)
 *   0 = anything less (a prefix/suffix/inflection on any covered token)
 *
 * Ranking looks at the COVERED span, not the whole candidate. A live-match
 * query carries the full source line ("2 Esslöffel Mandeln"); the ingredient
 * only covers "Mandeln", so requiring full-candidate coverage here would zero
 * the rank for both the canonical ("Mandel", prefix) and the verbatim alias
 * ("Mandeln", exact), handing the within-ingredient tie to the canonical and
 * dropping the plural the user actually typed. The leading qty/unit tokens are
 * equal for both rows, so they can't decide between them.
 *
 * Both sides are compared with token separators (hyphen, slash, comma…)
 * folded to spaces. The candidate tokenizer already splits on those, so the
 * matched span never carries a hyphen — comparing a hyphenated alias verbatim
 * would always lose. Folding makes a hyphen-only difference a TIE, which the
 * caller's isCanonical tiebreak then resolves toward the canonical (input
 * "plant-based meat" keeps the canonical "Plant-based meat", not the de-
 * hyphenated alias "plant based meat"). Genuine surface differences
 * (diacritics, distinct spelling) still separate the ranks.
 */
function toSurfaceSpan(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .split(/[\s,;/\-–—]+/u)
    .filter(Boolean)
    .join(" ");
}

function surfaceMatchRank(m: IngredientCandidateMatch): number {
  if (!m.perTokenKinds.every((k) => k === "exact")) return 0;
  const rawSpan = toSurfaceSpan(
    m.coveredCandidateTokens.map((i) => m.candidate[i].raw).join(" "),
  );
  return toSurfaceSpan(m.aliasName) === rawSpan ? 2 : 1;
}

/**
 * Pick the better of two matches for the SAME ingredient. Compares on the
 * score WITHOUT the canonical +1 boost so that boost can't let the canonical
 * shadow an equally-strong (or stronger) alias the user typed verbatim; the
 * surface-form rank decides those, with the canonical winning only true ties.
 */
function isBetterWithinIngredient(
  m: IngredientCandidateMatch,
  existing: IngredientCandidateMatch,
): boolean {
  const mBase = m.score - (m.isCanonical ? 1 : 0);
  const eBase = existing.score - (existing.isCanonical ? 1 : 0);
  if (mBase !== eBase) return mBase > eBase;
  const mRank = surfaceMatchRank(m);
  const eRank = surfaceMatchRank(existing);
  if (mRank !== eRank) return mRank > eRank;
  if (m.isCanonical !== existing.isCanonical) return m.isCanonical;
  return m.aliasName.length > existing.aliasName.length;
}

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
      if (!existing || isBetterWithinIngredient(m, existing.match)) {
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
