# Ingredient Matcher Structural Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the URL/paste ingredient matcher purely structural — gate on *lookup* coverage (not input coverage), discount post-comma tokens, derive name/notes from the matched span, allow penalized partial coverage — so prep/descriptor word-lists disappear from the matching path; surface a finished `{name, notes}` per candidate so pill selection is an idempotent replace; and copy amount/unit/notes onto alternatives at parse time.

**Architecture:** Two independent bodies of work.
- **Body 1 (Tasks 1–7):** Rework `src/lib/recipe-import/matching.ts` scoring + windowing, move name/notes derivation into a single `computeNameAndNotes` helper used for the top match *and* every candidate, drop the rematch/prep-strip machinery from the matched path (word-lists survive ONLY in the new-ingredient naming branch), and switch the UI pill handler to full-replace.
- **Body 2 (Tasks 8–9):** A post-pass in `parseIngredientLines` / `parseIngredientLinesIntoSections` that copies the primary's amount/unit onto alternatives lacking their own, and propagates the trailing note of the last group member to siblings without their own note.

**Tech Stack:** TypeScript, Next.js (customized), Vitest (`npm test` → `vitest run`), Drizzle/SQLite (no schema changes in this plan).

---

## Design reference (the agreed model)

**Scoring (per catalog entry against the input candidate tokens):**

| Component | Value |
|---|---|
| Matched entry token, input token **pre-comma** | +100 |
| Matched entry token, input token **post-comma** | +60 |
| Exact / close-inflection bonus (per matched token) | +20 |
| In-order (matched entry indices strictly increasing) | +10 |
| **Unmatched entry token** (partial coverage) | −50 |
| Canonical-row tiebreak | +1 |
| **Auto-pick threshold** | **130** |

- **Two axes:** input-side gaps (skipping input tokens *inside* the matched span) are NOT allowed — every input token in the matched window must align to an entry token; lookup-side partial coverage (entry tokens with no input match) IS allowed, penalized −50 each.
- **Name** = raw text of the matched span (first→last matched input token, including any interior tokens). **Notes** = input tokens before the span + input tokens after the span + base notes (parens/brackets/usage/"to taste"/range/secondary-amount notes the parser already extracted, with the comma-tail content subtracted to avoid double-counting).
- **Word-lists** (`PREP_LEADING_TOKENS`, `STANDALONE_DESCRIPTOR_NAMES`, `isPrepLeadingToken`, `isAllPrepLikeText`, `pickNameAndNotes`, `altWithPrepStripped`) remain ONLY in the new-ingredient naming branch (when nothing matches ≥ threshold). `SIZE_MODIFIER_TOKENS` stays in quantity/unit parsing; `containerTokens` + color-adjective guard stay in `splitConjunctions`. None of these are consulted on the matched path.

**Worked examples that must hold (these become tests):**

| Input | Catalog has | Resolves to | Notes |
|---|---|---|---|
| `Salt divided` | `Salt` | Salt | `divided` |
| `carrot, peeled and sliced` | `carrot` | carrot | `peeled and sliced` |
| `dry red wine` | `red wine` | red wine | `dry` |
| `olive oil, divided` | `olive oil` **+ polluted** `oil divided` | olive oil | `divided` |
| `frozen chick peas in a can` | `chick peas` | chick peas | `frozen, in a can` |
| `Tomaten` | `Tomate` + `Cherry Tomate` | Tomate | — (Cherry Tomate is a below-threshold candidate) |
| `Cherry Tomaten` | `Tomate` + `Cherry Tomate` | Cherry Tomate | — |
| `Paprika` (catalog) vs `Paprikapulver Rosenscharf` | — | **no auto-match** (110) | fragment stays below gate |

---

## File map

- **Modify** `src/lib/recipe-import/matching.ts` — `CandidateToken` gains `postComma`; `tokenizeCandidate` / `tokenizeCandidateJoinDashes` track it; new windowed partial-coverage search + scoring; each `IngredientCandidateMatch` carries its `candidate` token array; threshold → 130; delete `uncoveredTokens`/`tokensToNotes` (moved/retired).
- **Modify** `src/lib/recipe-import/index.ts` — add `computeNameAndNotes`; rewrite `resolveIngredientForRow` (matched path uses the helper; rematch branch deleted; new-ingredient branch keeps word-list cleanup); `ImportedCandidateMatch` gains `name`/`notes` (drops `uncoveredText`); `toImportedCandidateMatch` computes per-candidate name/notes; delete `foldMatchedCommaTailIntoName` and its `replaceCommaTailContent` helper.
- **Modify** `src/app/api/v1/ingredients/match/route.ts` — no logic change, but its response now carries the new candidate shape (name/notes).
- **Modify** `src/components/recipes/types.ts` — `DraftIngredientCandidate` gains `name`/`notes`, drops `uncoveredText`.
- **Modify** `src/components/recipes/ingredient-row.tsx` — `ServerMatch` gains `name`/`notes`, drops `uncoveredText`; `selectCandidate` becomes full-replace; delete `subtractTokensFromName` + `appendToNotes`; synthetic pins carry `{name, notes}`.
- **Modify (Body 2)** `src/lib/recipe-import/index.ts` — group post-pass for alternative amount/unit/notes inheritance.
- **Tests:** `tests/ingredient-matching.test.ts`, `tests/recipe-import-matching.test.ts`, `tests/recipe-import.test.ts`, `tests/familywall.test.ts` (existing — will need expectation updates), plus new cases added throughout.

> Run the full suite with `npm test`. Run a single file with `npm test -- tests/ingredient-matching.test.ts`. Run a single case with `npm test -- tests/ingredient-matching.test.ts -t "substring"`.

---

# Body 1 — Structural matcher + per-candidate name/notes + full-replace selection

### Task 1: `CandidateToken.postComma` + comma-aware tokenization

**Files:**
- Modify: `src/lib/recipe-import/matching.ts:100-138`
- Test: `tests/ingredient-matching.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/ingredient-matching.test.ts`:

```ts
import { tokenizeCandidate } from "@/lib/recipe-import/matching";

describe("tokenizeCandidate postComma", () => {
  it("flags every token after the first comma as postComma", () => {
    const toks = tokenizeCandidate("olive oil, divided");
    expect(toks.map((t) => t.raw)).toEqual(["olive", "oil", "divided"]);
    expect(toks.map((t) => t.postComma)).toEqual([false, false, true]);
  });

  it("treats tokens before any comma as pre-comma", () => {
    const toks = tokenizeCandidate("chick peas in a can");
    expect(toks.every((t) => t.postComma === false)).toBe(true);
  });

  it("still splits on semicolon/slash/dash without flagging postComma", () => {
    const toks = tokenizeCandidate("salz/pfeffer");
    expect(toks.map((t) => t.raw)).toEqual(["salz", "pfeffer"]);
    expect(toks.map((t) => t.postComma)).toEqual([false, false]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/ingredient-matching.test.ts -t "postComma"`
Expected: FAIL — `postComma` is `undefined` on the returned tokens.

- [ ] **Step 3: Implement**

In `src/lib/recipe-import/matching.ts`, replace the `CandidateToken` type and both tokenizers (currently lines ~100-138):

```ts
/** A token of the candidate text — normalised (matching), raw (note
 *  reconstruction), and whether it sits after the first top-level comma
 *  (post-comma tokens score fewer points; see {@link scoreMatch}). */
export type CandidateToken = {
  raw: string;
  normalized: string;
  postComma: boolean;
};

/** Splits a candidate into tokens. Commas are dropped as delimiters BUT flip
 *  every following token to `postComma: true` — the structural signal that a
 *  token reads more like an annotation than part of the core name. Other
 *  separators (whitespace, semicolon, slash, dash) split without affecting
 *  the comma flag. */
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

/** As {@link tokenizeCandidate}, but collapses dashes between two letters
 *  first so "Paprika-Pulver" reads as one token "paprikapulver". */
export function tokenizeCandidateJoinDashes(text: string): CandidateToken[] {
  const joined = text.replace(/(\p{L})[-–—](\p{L})/gu, "$1$2");
  return tokenizeCandidate(joined);
}
```

Delete the now-unused `TOKEN_SPLIT_RE` constant (lines ~110).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/ingredient-matching.test.ts -t "postComma"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipe-import/matching.ts tests/ingredient-matching.test.ts
git commit -m "feat(import): track post-comma position in candidate tokens"
```

---

### Task 2: Windowed partial-coverage matcher + new scoring

**Files:**
- Modify: `src/lib/recipe-import/matching.ts:148-340` (`bestMatchForEntry`, `alignEntryToWindow`, `scoreMatch`), `IngredientCandidateMatch` type (~66-98), `MIN_AUTO_MATCH_SCORE` (~371), `findIngredientCandidates` (~389-446)
- Test: `tests/ingredient-matching.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/ingredient-matching.test.ts`. These exercise the scoring contract directly via `findIngredientCandidates`. Build a tiny catalog helper at the top of the test file if one doesn't already exist:

```ts
import {
  findIngredientCandidates,
  type IngredientCatalog,
} from "@/lib/recipe-import/matching";
import { normalizeForMatch } from "@/lib/recipe-import/ingredient";

function entry(id: number, name: string, alias = name) {
  return {
    ingredientId: id,
    canonicalName: name,
    aliasName: alias,
    tokens: alias.split(/\s+/).map((t) => normalizeForMatch(t)),
  };
}

describe("structural matcher scoring", () => {
  it("single exact token clears 130 even with extra input tokens", () => {
    const cat: IngredientCatalog = [entry(1, "Salt")];
    const { matches } = findIngredientCandidates("Salt divided", cat);
    expect(matches[0].ingredientId).toBe(1);
    expect(matches[0].score).toBe(130);
    expect(matches[0].coveredCandidateTokens).toEqual([0]);
  });

  it("post-comma tokens are discounted so pre-comma 2-token wins over comma-spanning 2-token", () => {
    const cat: IngredientCatalog = [
      entry(1, "olive oil"),
      entry(2, "oil divided"), // simulates a polluted catalog row
    ];
    const { matches } = findIngredientCandidates("olive oil, divided", cat);
    expect(matches[0].ingredientId).toBe(1); // olive oil (250) beats oil divided (210)
    expect(matches[0].score).toBe(250);
    expect(matches.find((m) => m.ingredientId === 2)?.score).toBe(210);
  });

  it("full multi-token contiguous match scores 100/token + bonuses", () => {
    const cat: IngredientCatalog = [entry(1, "chick peas")];
    const { matches } = findIngredientCandidates("frozen chick peas in a can", cat);
    expect(matches[0].ingredientId).toBe(1);
    expect(matches[0].score).toBe(250);
    expect(matches[0].coveredCandidateTokens).toEqual([1, 2]);
  });

  it("partial lookup coverage is penalised and loses to the fully-covered shorter entry", () => {
    const cat: IngredientCatalog = [entry(1, "Tomate"), entry(2, "Cherry Tomate")];
    const { matches } = findIngredientCandidates("Tomaten", cat);
    expect(matches[0].ingredientId).toBe(1); // Tomate, 130
    expect(matches[0].score).toBe(130);
    const cherry = matches.find((m) => m.ingredientId === 2);
    expect(cherry?.score).toBe(80); // 100 + 20 + 10 - 50
  });

  it("full coverage of the longer entry wins when the input supports it", () => {
    const cat: IngredientCatalog = [entry(1, "Tomate"), entry(2, "Cherry Tomate")];
    const { matches } = findIngredientCandidates("Cherry Tomaten", cat);
    expect(matches[0].ingredientId).toBe(2);
    expect(matches[0].score).toBe(250); // 100 + 100 + 20 + 20 + 10
  });

  it("prefix fragments stay below the gate", () => {
    const cat: IngredientCatalog = [entry(1, "Paprika")];
    const { matches } = findIngredientCandidates("Paprikapulver Rosenscharf", cat);
    expect(matches[0]?.score ?? 0).toBeLessThan(130);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/ingredient-matching.test.ts -t "structural matcher scoring"`
Expected: FAIL — old scoring (base+anchor) produces different numbers and `Salt divided` returns 130 but is gated; `Tomaten` does not return a Cherry Tomate candidate at all.

- [ ] **Step 3: Implement the new matcher core**

In `src/lib/recipe-import/matching.ts`:

(a) Add `candidate` to the match type. Replace the `IngredientCandidateMatch` field block — keep all existing fields, drop `uncoveredText`, add `candidate`:

```ts
export type IngredientCandidateMatch = {
  ingredientId: number;
  canonicalName: string;
  aliasName: string;
  score: number;
  /** Indices (into {@link candidate}) of the input tokens this entry covers,
   *  in input order. The matched span runs from min→max of these. */
  coveredCandidateTokens: number[];
  perTokenKinds: MatchKind[];
  inOrder: boolean;
  defaultUnit?: { id: number; name: string };
  defaultSubUnit?: { id: number; name: string; perPurchase: number };
  isEquipment?: boolean;
  /** The exact candidate-token array (variant) this match was scored against,
   *  so the parser can derive name/notes from the matched span. */
  candidate: CandidateToken[];
  isCanonical: boolean;
};
```

(b) Replace `bestMatchForEntry`, `alignEntryToWindow`, and `scoreMatch` (lines ~148-315) with:

```ts
/** Per-aligned-token record: which input (window) token hit which entry
 *  token, and how. */
type AlignedTokenMatch = {
  kind: MatchKind;
  windowOffset: number; // index within the window
  entryIndex: number; // index within entry.tokens
  entryToken: string;
  windowToken: string;
};

/**
 * Align EVERY token of a contiguous input window to a DISTINCT entry token,
 * in input order, greedily preferring exact > prefix > suffix. Prefix/suffix
 * checks run both directions so the catalog or the candidate may hold the
 * longer form. Returns null if any window token can't be matched — that means
 * the window contains an interior input token that isn't part of this entry,
 * which would leave a gap in the name, so the window is invalid. Entry tokens
 * left unconsumed are reported by the caller as partial coverage.
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
 * Tiny weighted score. Gate is on ENTRY coverage, not input coverage:
 *  - +100 per matched entry token whose input token is pre-comma, +60 post-comma
 *  - +20 per matched token that's exact or close-inflection-shaped
 *  - +10 when the matched entry indices are strictly increasing (in order)
 *  - −50 per UNMATCHED entry token (partial coverage)
 * Extra INPUT tokens outside the window are free — they become notes.
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
 * (no interior input gaps). Entry tokens may be left uncovered (penalised).
 * The best-scoring window survives.
 */
function bestMatchForEntry(
  entry: CatalogEntry,
  candidate: CandidateToken[],
): IngredientCandidateMatch | null {
  const E = entry.tokens;
  if (E.length === 0 || candidate.length === 0) return null;
  const maxWin = Math.min(E.length, candidate.length);
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
      const coveredCandidateTokens = aligned.map((a) => start + a.windowOffset);
      const perTokenKinds = aligned.map((a) => a.kind);
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
        isEquipment: entry.isEquipment,
        candidate,
        isCanonical,
      };
    }
  }
  return best;
}
```

(c) Lower the threshold. Replace `export const MIN_AUTO_MATCH_SCORE = 135;` with:

```ts
/**
 * Minimum score to auto-resolve a row without user confirmation. A single
 * exact (or close-inflection) pre-comma token scores 100 + 20 + 10 = 130, so
 * the gate sits exactly there: clean single-token hits auto-pick, prefix
 * fragments (e.g. "Paprika" inside "Paprikapulver", 110) and partial-coverage
 * hits (penalised −50) stay below and only surface as pills.
 */
export const MIN_AUTO_MATCH_SCORE = 130;
```

(d) In `findIngredientCandidates`, return each match's own `candidate` (already on the match now). The function's `candidate` return value is still the top match's variant — keep it for callers that want the winning tokenisation, but the per-match `candidate` field is the source of truth for name/notes. No structural change needed beyond the match objects now carrying `candidate`. Delete the now-unused `uncoveredTokens` and `tokensToNotes` exports (lines ~448-465) — name/notes derivation moves to `index.ts` (Task 4). If TypeScript flags external references, those are fixed in Tasks 4–6.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/ingredient-matching.test.ts -t "structural matcher scoring"`
Expected: PASS. (Other tests in this file may now fail — they're updated in Task 3.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipe-import/matching.ts tests/ingredient-matching.test.ts
git commit -m "feat(import): structural matcher — entry-coverage gate, post-comma discount, partial coverage"
```

---

### Task 3: Reconcile existing matcher tests to the new model

**Files:**
- Modify: `tests/ingredient-matching.test.ts` (existing cases)
- Test: same file

- [ ] **Step 1: Run the existing suite and read every failure**

Run: `npm test -- tests/ingredient-matching.test.ts`
Expected: several existing assertions fail because (a) scores changed (135→130 base lines, anchor removed), and (b) some cases that were intentionally gated out (1-token fragment-at-start) are unchanged but their score numbers differ. Read each failure.

- [ ] **Step 2: Update expectations case-by-case**

For each failing existing case, recompute the expected value using the Task 2 table and update the assertion. Rules of thumb:
- Full single exact token: was 135 → now **130**.
- Full 2-token in-order exact: was 250 → still **250** (base 200 + 40 + 10; anchor +5 removed but it was full-coverage-from-start which no longer applies).
- Any assertion checking `uncoveredText` on a match: replace with a `coveredCandidateTokens` assertion (e.g. `expect(matches[0].coveredCandidateTokens).toEqual([0])`), since `uncoveredText` is removed from the match type.
- Cases asserting "fragment is rejected" (e.g. `Paprika` vs `Paprikapulver edelsüß`): keep the intent — assert `matches[0].score < 130` or that the correct longer entry wins.

Do NOT weaken a "must not merge distinct products" assertion — if the catalog in that test has only the broad entry, the new model WILL match it (descriptor → notes). That is the intended behavior change; update the test to assert the match + the descriptor landing in notes via the Task 4 path, OR add the specific entry to that test's catalog so the longer entry wins. Prefer adding the specific entry, mirroring real catalog seeding.

- [ ] **Step 3: Run to green**

Run: `npm test -- tests/ingredient-matching.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/ingredient-matching.test.ts
git commit -m "test(import): reconcile matcher tests with structural scoring"
```

---

### Task 4: `computeNameAndNotes` + rewrite `resolveIngredientForRow`

**Files:**
- Modify: `src/lib/recipe-import/index.ts` — add `computeNameAndNotes`; rewrite `resolveIngredientForRow` (lines ~627-804); delete `foldMatchedCommaTailIntoName` (~914-959) and `replaceCommaTailContent` (~878-896) if unused after; `ImportedCandidateMatch` type; `toImportedCandidateMatch`.
- Test: `tests/recipe-import-matching.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/recipe-import-matching.test.ts` (it already builds lookups + catalog; reuse its existing helper for seeding an ingredient — match the file's existing pattern for `parseIngredientLines` with a seeded catalog). Seed: `salt`, `red wine`, `chick peas`, `olive oil`, `carrot`.

```ts
describe("span-based name/notes on auto-pick", () => {
  it("Salt divided → Salt, note divided", () => {
    const [row] = parse("1 tsp Salt divided"); // `parse` = file's existing helper
    expect(row.ingredientMatch).toBe("existing");
    expect(row.name).toBe("Salt");
    expect(row.notes).toBe("divided");
  });

  it("carrot, peeled and sliced → carrot, note 'peeled and sliced'", () => {
    const [row] = parse("1 carrot, peeled and sliced");
    expect(row.name).toBe("carrot");
    expect(row.notes).toBe("peeled and sliced");
  });

  it("dry red wine → red wine, note dry", () => {
    const [row] = parse("100 ml dry red wine");
    expect(row.name).toBe("red wine");
    expect(row.notes).toBe("dry");
  });

  it("frozen chick peas in a can → chick peas, note 'frozen, in a can'", () => {
    const [row] = parse("1 frozen chick peas in a can");
    expect(row.name).toBe("chick peas");
    expect(row.notes).toBe("frozen, in a can");
  });

  it("each candidate carries its own name/notes", () => {
    const [row] = parse("1 frozen chick peas in a can");
    const top = row.candidateMatches[0];
    expect(top.name).toBe("chick peas");
    expect(top.notes).toBe("frozen, in a can");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/recipe-import-matching.test.ts -t "span-based name/notes"`
Expected: FAIL — `row.candidateMatches[0].name` is undefined; names still carry full text.

- [ ] **Step 3: Implement**

In `src/lib/recipe-import/index.ts`:

(a) Update the `ImportedCandidateMatch` type — drop `uncoveredText`, add `name`/`notes`:

```ts
export type ImportedCandidateMatch = {
  ingredientId: number;
  canonicalName: string;
  matchedName: string;
  score: number;
  /** Finished display name if the user picks this candidate — the matched
   *  span of the input. */
  name: string;
  /** Finished notes if the user picks this candidate — input tokens outside
   *  the span plus base notes. */
  notes: string | null;
  isEquipment: boolean;
};
```

(b) Add the shared helper near the other parse helpers (e.g. just above `resolveIngredientForRow`). It imports `subtractCommaTail` (already in this file) and `CandidateToken` from `./matching`:

```ts
/**
 * Derive a row's display name + notes from a matched span. The name is the
 * raw text of the input tokens from the first matched token to the last
 * (inclusive — interior unmatched tokens stay in the name, e.g. "bell" in
 * "red bell pepper"). Notes are the input tokens before the span + the tokens
 * after it + the parser's base notes (parens / brackets / usage / range /
 * "to taste"), with the comma-tail content subtracted so post-comma tokens
 * aren't double-counted (they're already represented in the candidate stream).
 */
function computeNameAndNotes(
  parsed: ParsedIngredient,
  candidate: CandidateToken[],
  coveredCandidateTokens: number[],
): { name: string; notes: string | null } {
  if (coveredCandidateTokens.length === 0) {
    return { name: parsed.name, notes: parsed.notes };
  }
  const lo = Math.min(...coveredCandidateTokens);
  const hi = Math.max(...coveredCandidateTokens);
  const name = candidate
    .slice(lo, hi + 1)
    .map((t) => t.raw)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const before = candidate
    .slice(0, lo)
    .map((t) => t.raw)
    .join(" ")
    .trim();
  const after = candidate
    .slice(hi + 1)
    .map((t) => t.raw)
    .join(" ")
    .trim();
  const baseNotes = subtractCommaTail(parsed.notes, parsed.commaTailText);
  const notes =
    [before, after, baseNotes ?? ""]
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join(", ") || null;
  return { name, notes };
}
```

(c) Rewrite `resolveIngredientForRow`. The matched path uses `computeNameAndNotes`; the rematch branch is DELETED; the new-ingredient branch keeps the word-list cleanup. Build the candidate once via `wideText = [name, commaTail].join(", ")` (note the **comma** separator, so the tail is flagged post-comma):

```ts
function resolveIngredientForRow(
  parsed: ParsedIngredient,
  rawLine: string,
  lookups: ParseLookups,
  autoMatchScoreThreshold: number,
): {
  name: string;
  notes: string | null;
  ingredientId: number | null;
  match: IngredientMatch;
  canonicalIngredientName: string | null;
  candidateMatches: ImportedCandidateMatch[];
  newNameProposals: ImportedNameProposal[];
  defaultUnit: { id: number; name: string } | null;
  defaultSubUnit: SubUnitRef | null;
  isEquipment: boolean;
} {
  const catalog = lookups.ingredientCatalog;
  let wideMatches: IngredientCandidateMatch[] = [];
  if (catalog && catalog.length > 0) {
    const wideText = [parsed.name, parsed.commaTailText]
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join(", ");
    if (wideText.length > 0) {
      const { matches } = findIngredientCandidates(wideText, catalog);
      wideMatches = matches;
      const top = matches[0];
      if (top && top.score >= autoMatchScoreThreshold) {
        const { name, notes } = computeNameAndNotes(
          parsed,
          top.candidate,
          top.coveredCandidateTokens,
        );
        return {
          name,
          notes,
          ingredientId: top.ingredientId,
          match: "existing",
          canonicalIngredientName:
            name.toLowerCase() === top.canonicalName.toLowerCase()
              ? null
              : top.canonicalName,
          candidateMatches: matches.map((m) =>
            toImportedCandidateMatch(m, parsed),
          ),
          newNameProposals: [],
          defaultUnit: top.defaultUnit ?? null,
          defaultSubUnit: top.defaultSubUnit ?? null,
          isEquipment: top.isEquipment ?? false,
        };
      }
    }
  }

  // No match above threshold → new ingredient. Word-lists live ONLY here:
  // prep-strip + comma-tail-identity cleanup produce a tidy new name.
  const cleaned = pickNameAndNotes(
    rawLine,
    parsed,
    lookups.ingredients,
    lookups.units.containerTokens,
  );
  const commaTailIsAllPrepLike =
    parsed.commaTailText.trim().length > 0 &&
    isAllPrepLikeText(parsed.commaTailText);
  const newName =
    parsed.commaTailText.trim().length > 0 && !commaTailIsAllPrepLike
      ? commaTailGoesAsPrefix(parsed.commaTailText)
        ? [parsed.commaTailText, cleaned.name].map((s) => s.trim()).join(" ")
        : [cleaned.name, parsed.commaTailText].map((s) => s.trim()).join(" ")
      : cleaned.name;
  const newNotes =
    parsed.commaTailText.trim().length > 0 && !commaTailIsAllPrepLike
      ? subtractCommaTail(cleaned.notes, parsed.commaTailText)
      : cleaned.notes;
  const proposals: ImportedNameProposal[] = [
    { name: newName, notes: newNotes, label: "Aufgeräumt" },
  ];
  if (newName.toLowerCase() !== parsed.name.toLowerCase()) {
    proposals.push({ name: parsed.name, notes: parsed.notes, label: "Wie eingegeben" });
  }
  return {
    name: newName,
    notes: newNotes,
    ingredientId: null,
    match: "new",
    canonicalIngredientName: null,
    candidateMatches: wideMatches.map((m) => toImportedCandidateMatch(m, parsed)),
    newNameProposals: proposals,
    defaultUnit: null,
    defaultSubUnit: null,
    isEquipment: false,
  };
}
```

(d) Update `toImportedCandidateMatch` to compute per-candidate name/notes:

```ts
function toImportedCandidateMatch(
  m: IngredientCandidateMatch,
  parsed: ParsedIngredient,
): ImportedCandidateMatch {
  const { name, notes } = computeNameAndNotes(
    parsed,
    m.candidate,
    m.coveredCandidateTokens,
  );
  return {
    ingredientId: m.ingredientId,
    canonicalName: m.canonicalName,
    matchedName: m.aliasName,
    score: m.score,
    name,
    notes,
    isEquipment: m.isEquipment ?? false,
  };
}
```

(e) Delete `foldMatchedCommaTailIntoName` (~914-959). Keep `subtractCommaTail`; delete `replaceCommaTailContent` only if no remaining references (the `tsc`/build step will confirm). Keep `pickNameAndNotes`, `isAllPrepLikeText`, `commaTailGoesAsPrefix`, `mergeCandidateLists` only if still referenced — `mergeCandidateLists` was only used by the deleted rematch branch, so delete it. Update the import from `./matching` to drop `uncoveredTokens`/`tokensToNotes` and add `type CandidateToken`.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/recipe-import-matching.test.ts -t "span-based name/notes"`
Expected: PASS.

- [ ] **Step 5: Reconcile the rest of `recipe-import-matching.test.ts`**

Run: `npm test -- tests/recipe-import-matching.test.ts`. Update any case asserting old fold/rematch behavior (e.g. "frischer Zucker" should now resolve via the matcher with `name: "Zucker"`, `notes: "frischer"` — same outcome, different path). Fix expectations; do not change intent.

- [ ] **Step 6: Commit**

```bash
git add src/lib/recipe-import/index.ts tests/recipe-import-matching.test.ts
git commit -m "feat(import): derive name/notes from matched span; drop rematch/fold path"
```

---

### Task 5: Match route + draft/UI candidate types

**Files:**
- Modify: `src/components/recipes/types.ts` (`DraftIngredientCandidate`)
- Modify: `src/app/api/v1/ingredients/match/route.ts` (no logic change; confirm it passes through `candidateMatches`)
- Test: build-time type check (no new unit test; covered by Task 6 behavior)

- [ ] **Step 1: Update `DraftIngredientCandidate`**

In `src/components/recipes/types.ts`, drop `uncoveredText`, add `name`/`notes`:

```ts
export type DraftIngredientCandidate = {
  ingredientId: number;
  canonicalName: string;
  matchedName: string;
  score: number;
  /** Finished display name to apply when the user picks this pill. */
  name: string;
  /** Finished notes to apply when the user picks this pill. */
  notes: string | null;
  isEquipment: boolean;
};
```

- [ ] **Step 2: Confirm the route needs no change**

`src/app/api/v1/ingredients/match/route.ts` returns `first.candidateMatches` verbatim — now carrying `name`/`notes`. No edit needed. Read it to confirm it doesn't destructure `uncoveredText`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `ingredient-row.tsx` (still references `uncoveredText`) — fixed in Task 6. No other files.

- [ ] **Step 4: Commit**

```bash
git add src/components/recipes/types.ts
git commit -m "feat(recipes): candidates carry finished name/notes instead of uncoveredText"
```

---

### Task 6: Full-replace pill selection (fixes the duplicate-notes bug)

**Files:**
- Modify: `src/components/recipes/ingredient-row.tsx` — `ServerMatch` type (~96-128); `selectCandidate` (~473-496); synthetic pin construction (~268-295, ~355-381); delete `subtractTokensFromName` (~137-165) and `appendToNotes` (~168-176)
- Test: manual + typecheck (UI; no vitest harness for this component — verify via `tsc` + the `verify` skill at the end)

- [ ] **Step 1: Update `ServerMatch`**

Replace the `ServerMatch` type (drop `uncoveredText`, add `name`/`notes`):

```ts
type ServerMatch = {
  ingredientId: number;
  canonicalName: string;
  matchedName: string;
  score: number;
  /** Finished display name applied on pick. */
  name: string;
  /** Finished notes applied on pick. */
  notes: string | null;
  isEquipment: boolean;
};
```

- [ ] **Step 2: Rewrite `selectCandidate` as full replace**

```ts
/** Click a candidate pill: replace the row's name + notes with the
 *  candidate's finished values (computed by the parser) and link the
 *  ingredient. Pure replace — idempotent, and switching pills never
 *  accumulates leftover notes. */
function selectCandidate(c: ServerMatch) {
  onChange({
    ...value,
    name: c.name,
    notes: c.notes ?? "",
    selectedIngredientId: c.ingredientId,
    canonicalName:
      c.name.toLowerCase() === c.canonicalName.toLowerCase()
        ? null
        : c.canonicalName,
    isOptional: value.isOptional || c.isEquipment,
    addAsAlias: false,
    unassigned: false,
    importAnnotation: clearAnnotationOn(value.importAnnotation, "ingredient"),
  });
}
```

- [ ] **Step 3: Update the synthetic pins to carry `{name, notes}`**

Find the two spots constructing synthetic `ServerMatch`-shaped objects (the current-selection pin around lines ~268-295 and ~355-381, previously setting `uncoveredText: ""`). For each, replace `uncoveredText: ""` with the row's current values so re-selecting is a no-op:

```ts
        name: value.name,
        notes: value.notes,
```

(Apply at both synthetic-pin construction sites. The synthetic pin represents "keep what's typed", so its name/notes are the current `value`.)

- [ ] **Step 4: Delete dead helpers**

Delete `subtractTokensFromName` (lines ~137-165) and `appendToNotes` (lines ~168-176). Remove any remaining references (e.g. `useCanonicalInName` does not use them; confirm).

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean (per `feedback_run_next_build` — the Docker build / `next build` catches RSC boundary issues `tsc` misses).

- [ ] **Step 6: Commit**

```bash
git add src/components/recipes/ingredient-row.tsx
git commit -m "fix(recipes): full-replace candidate selection — no more duplicated notes"
```

---

### Task 7: Sweep dead matcher code + full suite

**Files:**
- Modify: `src/lib/recipe-import/matching.ts` (remove leftover unused exports), `src/lib/recipe-import/index.ts`
- Test: full suite

- [ ] **Step 1: Find dead references**

Run:
```bash
grep -rn "uncoveredText\|uncoveredTokens\|tokensToNotes\|foldMatchedCommaTailIntoName\|replaceCommaTailContent\|mergeCandidateLists\|subtractTokensFromName\|appendToNotes" src/
```
Expected: no matches. Delete any stragglers and their now-orphaned imports.

- [ ] **Step 2: Update the matching.ts module docstring**

The header comment (lines ~1-41) describes the old anchor-bonus model. Rewrite it to describe the new model (entry-coverage gate, post-comma discount −40, partial coverage penalty −50, span→name/notes), so the file's documentation matches its behavior.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS. If `tests/recipe-import.test.ts` (the `parseIngredientString`-level tests) fail, they should only be assertions that overlapped with removed paths; reconcile expectations without changing intent.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(import): remove dead matcher/notes plumbing"
```

---

# Body 2 — Alternative amount/unit/notes inheritance (copy at parse time)

> Both `parseIngredientLines` and `parseIngredientLinesIntoSections` build groups as `[primary, alt, alt, ...]` rows (primary = `isAlternative: false`, tracked via `lastPrimaryIndex`). Inheritance is a post-pass over each completed group. Implement once as a helper and call it from both functions.

### Task 8: Copy primary amount/unit onto alternatives lacking their own

**Files:**
- Modify: `src/lib/recipe-import/index.ts` — add `applyAlternativeInheritance(group)` helper; call after each input line's rows are emitted in both `parseIngredientLines` and `parseIngredientLinesIntoSections`.
- Test: `tests/recipe-import-matching.test.ts`

- [ ] **Step 1: Write the failing test**

Seed catalog with `butter`, `margarine`, `egg`, `egg white`. Add:

```ts
describe("alternative amount/unit inheritance", () => {
  it("alt with no amount/unit inherits the primary's", () => {
    const rows = parse("200 g butter or margarine");
    const alt = rows.find((r) => r.isAlternative)!;
    expect(alt.quantity).toBe(200);
    expect(alt.unit?.name).toBe(rows[0].unit?.name);
    expect(alt.fixedAmount).toBe(rows[0].fixedAmount);
  });

  it("alt that brought its own quantity keeps it", () => {
    const rows = parse("2 eggs or 3 egg whites");
    const alt = rows.find((r) => r.isAlternative)!;
    expect(alt.quantity).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/recipe-import-matching.test.ts -t "alternative amount/unit inheritance"`
Expected: FAIL — alt quantity is null/1 (no inheritance today).

- [ ] **Step 3: Implement the helper + call sites**

Add to `src/lib/recipe-import/index.ts`:

```ts
/**
 * Copy a primary row's amount/unit onto each following alternative that
 * parsed NEITHER its own quantity NOR its own unit. An alternative that
 * supplied either keeps what it parsed. When the primary's amount uses a
 * sub-unit, we copy the quantity but leave the alt's unit unset rather than
 * point it at the primary ingredient's sub-unit (a foreign sub-unit id);
 * the caller's unit resolution / the user fills it in.
 *
 * `rows` is the slice of output rows produced from a single input line, in
 * order: [primary, alt, alt, ...]. Mutates the alternative rows in place.
 */
function applyAlternativeInheritance(rows: ImportedIngredient[]): void {
  if (rows.length < 2) return;
  const primary = rows[0];
  if (primary.isAlternative) return; // defensive: no leading primary
  for (let i = 1; i < rows.length; i++) {
    const alt = rows[i];
    if (!alt.isAlternative) break; // next primary starts a new group
    const hasOwnAmount = alt.quantity !== null;
    const hasOwnUnit = alt.unit !== null || alt.subUnit !== null;
    if (hasOwnAmount || hasOwnUnit) continue;
    alt.quantity = primary.quantity;
    alt.fixedAmount = primary.fixedAmount;
    if (primary.subUnit) {
      // Foreign sub-unit — copy the amount only; leave unit unset.
      alt.unit = null;
      alt.subUnit = null;
    } else {
      alt.unit = primary.unit;
    }
  }
}
```

Wire it into `parseIngredientLines`: today rows are pushed into a flat `out` array per `rawLine`. Track the index where this line's rows begin and call the helper on that slice after the inner loops complete. At the top of the `for (const rawLine of lines)` body add `const lineStart = out.length;`. Immediately before the end of that loop body (after the `for (const row of expandIngredientLine(rawLine))` loop), add:

```ts
    applyAlternativeInheritance(out.slice(lineStart));
```

Because `out.slice` returns shallow copies of the *array* but the elements are the same object references, in-place mutation of the alt objects affects `out`. (Verify: `ImportedIngredient` rows are objects; slice copies references. Mutation propagates. The test confirms.)

For `parseIngredientLinesIntoSections`, the rows go into `currentGroup.ingredients`. Track `const lineStart = currentGroup.ingredients.length;` at the start of the line body and call `applyAlternativeInheritance(currentGroup.ingredients.slice(lineStart))` at the end of the line body. If a section header mid-line moves `currentGroup`, scope `lineStart` to the active group — simplest is to capture the group reference + start index together and apply against whatever group the last primary landed in. Match the existing `lastPrimaryIndex` scoping in that function.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/recipe-import-matching.test.ts -t "alternative amount/unit inheritance"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipe-import/index.ts tests/recipe-import-matching.test.ts
git commit -m "feat(import): alternatives inherit primary amount/unit at parse time"
```

---

### Task 9: Propagate the group's trailing note to siblings without their own

**Files:**
- Modify: `src/lib/recipe-import/index.ts` — extend `applyAlternativeInheritance`
- Test: `tests/recipe-import-matching.test.ts`

- [ ] **Step 1: Write the failing test**

Seed catalog with `bacon`, `pancetta`, `onion`, `shallot`. Add:

```ts
describe("alternative note propagation", () => {
  it("trailing note of the last member propagates to siblings without their own", () => {
    const rows = parse("2 slices bacon or pancetta, diced");
    const bacon = rows[0];
    const pancetta = rows.find((r) => r.isAlternative)!;
    expect(pancetta.notes).toBe("diced");
    expect(bacon.notes).toBe("diced"); // propagated backward
  });

  it("members with their own note keep it (no propagation)", () => {
    const rows = parse("1 onion, finely chopped, or 2 shallots, diced");
    expect(rows[0].notes).toBe("finely chopped");
    expect(rows.find((r) => r.isAlternative)!.notes).toBe("diced");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/recipe-import-matching.test.ts -t "alternative note propagation"`
Expected: FAIL — bacon has no note; only pancetta carries "diced".

- [ ] **Step 3: Implement**

Extend `applyAlternativeInheritance` — after the amount/unit loop, add the note propagation. The "group's shared note" is the notes of the LAST member of the group:

```ts
  // Note propagation: the trailing note of the LAST group member reads as a
  // group-wide note (recipes write shared prep at the end: "bacon or
  // pancetta, diced"). Apply it to every earlier member that has no note of
  // its own. Members with their own note keep it.
  let lastIdx = 0;
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i].isAlternative) break;
    lastIdx = i;
  }
  const sharedNote = rows[lastIdx].notes?.trim();
  if (sharedNote && sharedNote.length > 0) {
    for (let i = 0; i <= lastIdx; i++) {
      if (i === lastIdx) continue;
      const cur = rows[i].notes?.trim();
      if (!cur || cur.length === 0) {
        rows[i].notes = sharedNote;
      }
    }
  }
```

Place this block inside `applyAlternativeInheritance`, after the amount/unit `for` loop, guarded by the same `rows.length < 2` early return already at the top.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/recipe-import-matching.test.ts -t "alternative note propagation"`
Expected: PASS.

- [ ] **Step 5: Full suite + build**

Run: `npm test && npm run build`
Expected: PASS + clean build.

- [ ] **Step 6: Commit**

```bash
git add src/lib/recipe-import/index.ts tests/recipe-import-matching.test.ts
git commit -m "feat(import): propagate the group's trailing note to alternative siblings"
```

---

## Final verification

- [ ] Run `npm test` — all green.
- [ ] Run `npm run build` — clean (catches RSC client/server boundary issues `tsc` misses; see `feedback_run_next_build`).
- [ ] Manually verify the dup-notes fix and the matcher in the running app via the `verify` skill: import a recipe with lines `1 tsp salt, divided`, `100 ml dry red wine`, `2 slices bacon or pancetta, diced`; confirm names/notes resolve per the table and that repeatedly clicking a candidate pill no longer appends notes.

## Out of scope (explicitly)

- Issue 4 ("2 slices bacon" keeping `slices` in the name) — treated as a data fix (the `slices bacon` alias / its `Scheibe` sub-unit), not a parser change.
- No-comma prep conjunctions ("carrot peeled and sliced" without a comma) can still orphan a trailing descriptor via `splitConjunctions`; the comma form (the reported case) is fixed. Revisit only if it shows up in real imports.
- Familywall: it passes `autoMatchScoreThreshold: 130` + `alternativesMode: "first-wins"` (`src/lib/familywall/transform.ts:396-397`). After the scoring change, run `npm test -- tests/familywall.test.ts` and retune that threshold value (likely lower, ~110-120) until the familywall suite is green — its catalog is exhaustive so it wants a looser gate. Do this as part of Task 7's "run the full suite" if failures surface there.
