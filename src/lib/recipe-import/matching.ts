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
  /** Per-alias default unit — flows through to the parser so a matched alias
   *  can still influence unit selection downstream. */
  defaultUnit?: { id: number; name: string };
  /** CURATED default unit id (alias default → ingredient default; the global
   *  default unit deliberately does NOT flow in) used by the unit decider in
   *  {@link findIngredientCandidates}. Distinct from {@link defaultUnit},
   *  which is the display unit for the row; this is the matching signal —
   *  undefined means "nobody declared a unit", so the entry can never be
   *  "confirmed" by a line unit (in particular not by a defaulted one). */
  unitId?: number;
  /** Optional per-alias rename: when this entry is the match, the row's
   *  display name becomes this instead of the alias text ("Knoblauchzehe" →
   *  "Knoblauch"). Undefined = show the matched alias verbatim. */
  displayName?: string;
  /** True when the underlying ingredient is flagged as equipment (Backpapier,
   *  Einmachgläser, …). The parser uses this to default the recipe row to
   *  `isOptional=true` so the user decides per-recipe whether to shop it. */
  isEquipment?: boolean;
};

export type IngredientCatalog = CatalogEntry[];

export type MatchKind = "exact" | "prefix" | "suffix" | "fuzzy";

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
  /** Resolved unit id for the unit decider — see {@link CatalogEntry.unitId}. */
  unitId?: number;
  displayName?: string;
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
  /** True for tokens inside a parenthetical. Parens are a structural
   *  annotation marker: their content is NEVER part of a match window (the
   *  example in "Pilze (z. B. braune Champignons)" must not steal the
   *  mapping from the generic), but the raw tokens stay available for the
   *  verbatim notes reconstruction. */
  inParens: boolean;
  /** Set when this token was split off the PREVIOUS one at an intra-word
   *  dash ("whole-wheat" → "whole" + "wheat") — holds the dash character so
   *  the verbatim notes reconstruction can re-join the compound exactly as
   *  written. Undefined for ordinary whitespace-separated tokens. */
  joinedByDash?: string;
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
  let parenDepth = 0;
  // Keep commas as their own pieces so we can flip the flags as we cross them.
  for (const segment of text.split(/(,)/u)) {
    if (segment === ",") {
      postComma = true;
      pendingComma = true;
      continue;
    }
    // Keep fraction slashes ("1/2") as one token — notes are reconstructed
    // from raw tokens and must not degrade to "1 2". A non-fraction slash
    // ("und/oder", "14 tbsp / 1 sticks") splits for MATCHING but is remembered
    // as a " / " separator on the next token (via `joinedByDash`) so notes
    // reconstruction restores the slash — every special char survives in notes.
    // Intra-word dashes split for MATCHING ("Cherry-Tomate" → 2 tokens) but are
    // likewise remembered so notes restore "whole-wheat".
    let pendingSlash = false;
    let pendingSemicolon = false;
    for (const piece of segment
      .replace(/(?<!\d)\/|\/(?!\d)/g, " / ")
      // A semicolon splits for MATCHING but, like the slash above, is kept as
      // its own piece and remembered as a "; " separator on the next token so
      // notes reconstruction restores it ("1-inch; about 10 cups").
      .replace(/;/g, " ; ")
      .split(/\s+/u)) {
      if (piece.length === 0) continue;
      if (piece === "/") {
        pendingSlash = true;
        continue;
      }
      if (piece === ";") {
        pendingSemicolon = true;
        continue;
      }
      const subs = piece.split(/([-–—])/);
      let pendingDash: string | undefined;
      let emittedInPiece = false;
      for (const sub of subs) {
        if (/^[-–—]$/.test(sub)) {
          if (emittedInPiece) pendingDash = sub;
          continue;
        }
        if (sub.length === 0) continue;
        const raw = sub;
        const opens = (raw.match(/\(/g) ?? []).length;
        const closes = (raw.match(/\)/g) ?? []).length;
        const inParens = parenDepth > 0 || opens > 0;
        parenDepth = Math.max(0, parenDepth + opens - closes);
        const normalized = canonicalizeMatchToken(normalizeForMatch(raw));
        if (normalized.length === 0) continue;
        // A leading separator the source used, restored verbatim in notes. A
        // comma is handled separately (precededByComma); otherwise an outer
        // "; " wins over a " / " slash, which wins over an intra-word dash (a
        // token can carry only one immediate predecessor separator).
        const leadingSep = pendingComma
          ? undefined
          : pendingSemicolon
            ? "; "
            : pendingSlash
              ? " / "
              : pendingDash !== undefined
                ? pendingDash
                : undefined;
        out.push({
          raw,
          normalized,
          postComma,
          precededByComma: pendingComma,
          inParens,
          ...(leadingSep !== undefined ? { joinedByDash: leadingSep } : {}),
        });
        pendingComma = false;
        pendingDash = undefined;
        pendingSlash = false;
        pendingSemicolon = false;
        emittedInPiece = true;
      }
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
  let parenDepth = 0;
  for (const segment of text.split(/(,)/u)) {
    if (segment === ",") {
      postComma = true;
      pendingComma = true;
      continue;
    }
    // Split on whitespace / semicolon / slash, but not on dashes between
    // letters. Standalone / padded dashes still separate (handled by the
    // surrounding whitespace).
    for (const raw of segment
      .replace(/(?<!\d)\/|\/(?!\d)/g, " ")
      .split(/[\s;]+/u)) {
      if (raw.length === 0) continue;
      const opens = (raw.match(/\(/g) ?? []).length;
      const closes = (raw.match(/\)/g) ?? []).length;
      const inParens = parenDepth > 0 || opens > 0;
      parenDepth = Math.max(0, parenDepth + opens - closes);
      const normalized = canonicalizeMatchToken(
        normalizeForMatch(raw.replace(/(\p{L})[-–—](\p{L})/gu, "$1$2")),
      );
      if (normalized.length === 0) continue;
      out.push({
        raw,
        normalized,
        postComma,
        precededByComma: pendingComma,
        inParens,
      });
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
      } else if (
        // Lowest-priority tier: a single-typo (edit distance 1) match, gated to
        // tokens of at least 5 chars so short words — where one edit flips the
        // meaning (Salz/Salm, Reis/Reise) — never fuzzy-match. Earns NO bonus
        // (see {@link scoreMatch}), so a LONE fuzzy token stays below the
        // auto-pick gate (a suggestion, never a silent pick); it only tips the
        // balance when it COMPLETES a multi-token alias whose other tokens are
        // real matches ("planzliche Milch" → "pflanzliche Milch").
        Math.min(wt.length, et.length) >= 5 &&
        isEditDistance1(wt, et)
      ) {
        rank = 3;
        kind = "fuzzy";
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
    // A fuzzy (single-typo) alignment earns NO per-token bonus — it would
    // otherwise be handed the +20 "close inflection" bonus (an equal-length
    // typo like "kale"/"kase" has ratio 1.0), pushing a lone fuzzy token to
    // the auto-pick gate. Zero bonus keeps lone fuzzy matches below it.
    // SUFFIX alignments are excluded for the same reason: German inflection
    // changes a word's END, so genuine inflection pairs share a PREFIX. Two
    // tokens sharing only a suffix ("ohne"/"Bohne", "Reis"/"Preis") differ
    // at the START — different stems — and must not be lifted over the gate
    // by the closeness bonus (prod case: "(ca. 500 g ohne Schale)"
    // auto-matched Bohne via the stopword "ohne").
    const bonus =
      a.kind === "fuzzy" || a.kind === "suffix"
        ? 0
        : perTokenBonus(a.entryToken, a.windowToken);
    s += base + bonus;
  }
  if (inOrder) s += 10;
  s -= unmatchedEntryCount * 120;
  return s;
}

/**
 * True iff `a` and `b` are within Levenshtein edit distance 1 (a single
 * substitution, insertion, or deletion). Backs the lowest-priority "fuzzy"
 * alignment tier; callers gate it on a min token length so short words never
 * fuzzy-match.
 */
function isEditDistance1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let diff = 0;
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i] && ++diff > 1) return false;
    }
    return true; // 1 substitution (0 diffs means a === b, handled above)
  }
  // One insertion/deletion: walk the shorter string against the longer.
  const [short, long] = la < lb ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i += 1;
      j += 1;
    } else {
      if (skipped) return false;
      skipped = true;
      j += 1;
    }
  }
  return true;
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
  // The "canonical row" (aliasName === canonicalName) is preferred over
  // otherwise-equal alias hits — but only as a SORT tiebreak, never as a
  // score increment. Folding it into the score let a canonical's non-exact
  // alignment outscore another ingredient's verbatim EXACT alias by 1
  // ("Erdnussöl" prefix beat the curated alias "Erdnuss" on Erdnüsse).
  const isCanonical =
    entry.aliasName.toLowerCase() === entry.canonicalName.toLowerCase();
  let best: IngredientCandidateMatch | null = null;
  for (let start = 0; start < candidate.length; start++) {
    // Paren content is matcher-invisible: a window may not contain a token
    // inside a parenthetical (see {@link CandidateToken.inParens}).
    if (candidate[start].inParens) continue;
    for (let len = 1; start + len <= candidate.length && len <= maxWin; len++) {
      if (candidate[start + len - 1].inParens) break;
      const window = candidate.slice(start, start + len);
      const aligned = alignWindowToEntry(window, E);
      if (!aligned) continue;
      const inOrder = aligned.every(
        (a, i) => i === 0 || a.entryIndex > aligned[i - 1].entryIndex,
      );
      const unmatchedEntryCount = E.length - aligned.length;
      const score = scoreMatch(aligned, window, inOrder, unmatchedEntryCount);
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
        unitId: entry.unitId,
        displayName: entry.displayName,
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

/**
 * Blocking keys for a normalised token: the token itself plus its first-3 and
 * last-3 character "blocks". Two tokens that can align in the matcher share at
 * least one block — exact (same token), prefix (same first 3), suffix (same
 * last 3). This is what lets {@link buildCatalogBlockIndex} prune the catalog to
 * a handful of candidates per line instead of scoring all ~3,000 entries.
 *
 * Caveat: a single-substitution fuzzy match whose edit lands on the exact
 * middle char of a 5–7 char token shares no block — so the index can miss that
 * narrow case. Fuzzy is the lowest-priority tier (no bonus, only completes a
 * multi-token alias), and the index is OPT-IN — only the bulk-reparse scan uses
 * it; live `/match` and recipe import keep the full sweep — so interactive
 * matching is unaffected. The reparse equivalence test guards the corpus.
 */
function blockKeys(token: string): string[] {
  if (token.length < 3) return [token];
  return [token, `^${token.slice(0, 3)}`, `${token.slice(-3)}$`];
}

/** token-block → catalog entry indices. Built from a specific catalog array;
 *  must be passed to {@link findIngredientCandidates} alongside that SAME
 *  catalog (the indices point into it). */
export type CatalogBlockIndex = Map<string, number[]>;

/** Build the blocking index for a catalog. Reuse it across many lines (e.g. the
 *  bulk scan) so its build cost amortises. */
export function buildCatalogBlockIndex(catalog: IngredientCatalog): CatalogBlockIndex {
  const index: CatalogBlockIndex = new Map();
  catalog.forEach((entry, i) => {
    const added = new Set<string>();
    for (const tok of entry.tokens) {
      for (const key of blockKeys(tok)) {
        if (added.has(key)) continue;
        added.add(key);
        const arr = index.get(key);
        if (arr) arr.push(i);
        else index.set(key, [i]);
      }
    }
  });
  return index;
}

export type FindCandidatesOptions = {
  /** Cap on returned matches. Defaults to 5. */
  limit?: number;
  /** Optional prebuilt {@link CatalogBlockIndex} for the SAME catalog. When
   *  given, only entries sharing a token block with the line are scored
   *  (≈20× fewer for a 3,000-entry catalog) — results are identical to the full
   *  sweep, it just skips entries that provably cannot align. */
  index?: CatalogBlockIndex;
  /** Resolved canonical unit id of the line being matched (or null). When set,
   *  a gate-clearing candidate whose resolved unit equals this id gets its SORT
   *  weight doubled — the unit decides between name-plausible candidates
   *  (canned "Dose" vs fresh "Stück"). The gate itself still reads the
   *  undoubled `score`, so the unit can never push a below-gate match to an
   *  auto-pick. */
  lineUnitId?: number | null;
  /** Score a candidate must reach (on its undoubled name score) to qualify for
   *  unit doubling. Defaults to {@link MIN_AUTO_MATCH_SCORE}. */
  gateScore?: number;
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
 * Pick the better of two matches for the SAME ingredient. Scores carry no
 * canonical boost (it lives in the sort tiebreaks), so the canonical can't
 * shadow an equally-strong (or stronger) alias the user typed verbatim; the
 * surface-form rank decides those, with the canonical winning only true ties.
 */
function isBetterWithinIngredient(
  m: IngredientCandidateMatch,
  existing: IngredientCandidateMatch,
): boolean {
  if (m.score !== existing.score) return m.score > existing.score;
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

  // With a block index, score only the entries that share a token block with
  // some variant token — every entry that could possibly align. Without it,
  // score the whole catalog (unchanged behaviour). The pruned set is a strict
  // superset of the full sweep's actual matches, so results are identical.
  let entriesToScan: IngredientCatalog = catalog;
  if (options.index) {
    const idx = new Set<number>();
    for (const variant of variants) {
      for (const t of variant) {
        for (const key of blockKeys(t.normalized)) {
          const arr = options.index.get(key);
          if (arr) for (const i of arr) idx.add(i);
        }
      }
    }
    entriesToScan = Array.from(idx, (i) => catalog[i]);
  }

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
    for (const entry of entriesToScan) {
      const m = bestMatchForEntry(entry, variant);
      if (!m) continue;
      const existing = bestById.get(m.ingredientId);
      if (!existing || isBetterWithinIngredient(m, existing.match)) {
        bestById.set(m.ingredientId, { match: m, variant });
      }
    }
  }
  // Unit decider: the line's resolved unit doubles a candidate's SORT weight
  // when that candidate already clears the gate on its NAME score and its
  // resolved unit equals the line's unit. Gating on the undoubled score is what
  // stops the unit from crossing the auto-match gate — `match.score` is left
  // untouched (the caller's gate check reads it), only ranking changes.
  const lineUnitId = options.lineUnitId ?? null;
  const gate = options.gateScore ?? MIN_AUTO_MATCH_SCORE;
  const rankWeight = (m: IngredientCandidateMatch): number =>
    lineUnitId != null && m.unitId === lineUnitId && m.score >= gate
      ? m.score * 2
      : m.score;
  // Cross-ingredient exactness: the worst alignment kind across the match's
  // tokens (exact < prefix < suffix < fuzzy). At equal score, a verbatim
  // exact hit must outrank one that needed a looser alignment — "Erdnuss"
  // exactly hitting the Erdnüsse alias beats "Erdnussöl", whose 2-char
  // compound head slips through the close-inflection bonus as a prefix.
  const KIND_RANK: Record<MatchKind, number> = {
    exact: 0,
    prefix: 1,
    suffix: 2,
    fuzzy: 3,
  };
  const worstKind = (m: IngredientCandidateMatch): number =>
    m.perTokenKinds.reduce((w, k) => Math.max(w, KIND_RANK[k]), 0);
  // Position: where the match's covered span starts in the input. Trailing
  // content in ingredient lines is overwhelmingly annotation ("z.B.
  // Olivenöl", "for garnish"), so at equal score and exactness the EARLIER
  // match is the product term ("Öl z.B. Olivenöl" → Öl). Purely structural —
  // replaces the ranking role the z.B./zum boundary word-lists used to play.
  const startPos = (m: IngredientCandidateMatch): number =>
    m.coveredCandidateTokens.length > 0
      ? Math.min(...m.coveredCandidateTokens)
      : Number.MAX_SAFE_INTEGER;
  const sorted = Array.from(bestById.values()).sort((a, b) => {
    const aw = rankWeight(a.match);
    const bw = rankWeight(b.match);
    if (aw !== bw) return bw - aw;
    const ak = worstKind(a.match);
    const bk = worstKind(b.match);
    if (ak !== bk) return ak - bk;
    const ap = startPos(a.match);
    const bp = startPos(b.match);
    if (ap !== bp) return ap - bp;
    // Equally-exact and equally-positioned: prefer the candidate whose
    // winning row is the canonical. This is THE canonical preference now —
    // scores carry no canonical boost.
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
