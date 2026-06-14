# Entity-First Ingredient Parser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the catalog drive ingredient-line *structure* (where to split on und/oder), confining judgment vocabulary to the one place the spec allows: naming a brand-new ingredient when nothing matched.

**Architecture:** The current parser is *segment-first*: `segmentLine` cuts the line into segments using word-list guards (`preIsHeadlessModifier`, `isColorAdjective`, `KNOWN_PAIRS`) *before* the amount/ingredient are known; then `parseLeaves` parses each segment. We move the split decision onto the catalog: a connector splits only when both flanking fragments are *ingredient-like* (a catalog match, or a fragment that has its own head noun). The descriptor vocabulary survives only as the "does this fragment have a head noun / is it a nameable ingredient" test used by that predicate and the no-match namer — never as a standalone split guard.

**Tech Stack:** TypeScript, Vitest. Parser lives under `src/lib/recipe-import/`. Spec: `docs/superpowers/specs/2026-06-14-entity-first-ingredient-parser-design.md`.

**The parity oracle:** ~4,553 lines of parser tests + the Familywall golden corpus encode today's behavior. Every change keeps the full suite green; any deliberate behavioral change rewrites the affected test with a justification comment.

---

## Phase-to-task mapping

The spec defines four phases. Phase 0 (the `preIsHeadlessModifier` unit-skip stopgap) is already on this branch (commit `559390f`). This plan implements **Phase 2 (match-driven split)** as the centerpiece — it removes the structural word lists the user objects to and fixes the amount-stranding bug class. Phases 1 (whole-line amount annotation) and 4 (consolidate namer) are scoped as follow-ups; Phase 3 (matched-path name cleanup) is already satisfied by the AST architecture (the matched path in `applyMatch` never pre-strips prep words — only the `noMatch` namer uses `PREP_WORDS`/`VAGUE_WORDS`).

Key constraint discovered during design: `segs`/`parse` test helpers pass an **empty** `knownIngredients` set, yet `"Salz und Pfeffer"` must split while `"yellow and red grape tomatoes"` and `"6 dried or fresh shiitake mushrooms"` must not. So the descriptor/color recognition must remain available to the split predicate as the "is this fragment a nameable ingredient" test — the spec's allowed home — applied symmetrically to both sides of the connector.

---

## Task 1: Corpus-parity harness (safety net)

**Files:**
- Create: `tests/recipe-import.parity.test.ts`

A guard that snapshots the parse of a representative line set so an unintended behavioral change in later tasks shows up as a diff, not a silent regression. The Familywall golden test already does this for its corpus; this adds the und/oder/descriptor cases central to Phase 2.

- [ ] **Step 1: Write the parity snapshot test**

```ts
import { describe, it, expect } from "vitest";
import { parseIngredientLines, type ParseLookups } from "@/lib/recipe-import";

// A focused corpus of the split/guard cases Phase 2 touches. Each line is parsed
// with the SAME empty-catalog lookups the unit tests use, so the snapshot pins
// the descriptor/color/headless behavior that must survive the refactor.
const LINES = [
  "Salz und Pfeffer",
  "Salz & Pfeffer",
  "Salt and Pepper",
  "2 cups mixed yellow and red grape tomatoes (halved)",
  "gelbe und rote Paprika",
  "6 dried or fresh shiitake mushrooms",
  "200 g Weizen- oder Dinkelmehl",
  "100 g Mehl und Zucker",
  "Honig oder Ahornsirup",
];

const EMPTY_LOOKUPS: ParseLookups = {
  units: {
    byNameOrAlias: new Map(), byCanonicalName: new Map(), byId: new Map(),
    containerTokens: new Set(), unspecificTokens: new Set(),
    maxUnitTokens: 1, globalDefaultUnitId: null,
  },
  ingredients: new Map(),
  ingredientCatalog: [],
};

describe("parser parity corpus (Phase 2 guard cases)", () => {
  for (const line of LINES) {
    it(`parity: ${line}`, () => {
      const rows = parseIngredientLines([line], EMPTY_LOOKUPS).map((r) => ({
        name: r.name, quantity: r.quantity, unit: r.unit?.name ?? null,
        notes: r.notes, isAlternative: r.isAlternative,
      }));
      expect(rows).toMatchSnapshot();
    });
  }
});
```

- [ ] **Step 2: Generate the baseline snapshot**

Run: `npx vitest run tests/recipe-import.parity.test.ts`
Expected: PASS, writes `tests/__snapshots__/recipe-import.parity.test.ts.snap`. This snapshot is the pre-change truth; later tasks must not change it except where a test is deliberately rewritten.

- [ ] **Step 3: Commit**

```bash
git add tests/recipe-import.parity.test.ts tests/__snapshots__/recipe-import.parity.test.ts.snap
git commit -m "test(parser): parity snapshot for und/oder split guard cases"
```

---

## Task 2: Introduce the `fragmentIsIngredientLike` predicate

**Files:**
- Modify: `src/lib/recipe-import/ast/segment-line.ts`

A single predicate the split rules consult. Replaces the scattered guards. `ingredient-like` = the fragment names a catalog entry (`itemMatchesCatalog`, already present) OR has its own head noun (`!preIsHeadlessModifier` on the fragment text, the descriptor vocabulary as the head-noun test).

- [ ] **Step 1: Write the predicate (no call sites yet)**

```ts
/**
 * Whether a connector-flanking fragment [a,b) is a nameable ingredient: it
 * either names a catalog entry, or carries its own head noun (it is NOT just an
 * amount + descriptors). The descriptor vocabulary lives here as the head-noun
 * test (the spec's one allowed home), never as a standalone split guard.
 */
function fragmentIsIngredientLike(
  source: string,
  all: readonly Leaf[],
  a: number,
  b: number,
  opts: SegmentOptions,
): boolean {
  if (itemMatchesCatalog(all, a, b, opts.knownIngredients)) return true;
  const text = source.slice(all[a].start, all[b - 1].end).trim();
  return !preIsHeadlessModifier(text, opts.unitTokens);
}
```

- [ ] **Step 2: Run the suite (no behavior change yet)**

Run: `npx vitest run tests/recipe-import-matching.test.ts tests/recipe-import.test.ts tests/recipe-import.familywall-golden.test.ts`
Expected: PASS (314) — the predicate is dead code so far; this confirms it compiles.

- [ ] **Step 3: Commit**

```bash
git add src/lib/recipe-import/ast/segment-line.ts
git commit -m "refactor(parser): add fragmentIsIngredientLike predicate (unused)"
```

---

## Task 3: Drive the or-chain split on the predicate

**Files:**
- Modify: `src/lib/recipe-import/ast/segment-line.ts` (the "oder/or/o." chain block, ~lines 500-540)

Replace the asymmetric `!preIsHeadlessModifier(primaryText)` primary-only guard with: split the chain only when **every** segment is ingredient-like (symmetric). This fixes the tortellini class (one side a bare descriptor → no split) without a special-cased word list, and keeps `Rohrzucker oder brauner Zucker` splitting (both ingredient-like).

- [ ] **Step 1: Replace the guard condition**

```ts
    const seps = orSeparators(all, from, to, baseDepth);
    if (seps.length > 0) {
      const segs = sliceBySeps(all, from, to, seps);
      const primaryEnd = segs[0].to;
      const endsWithDash =
        primaryEnd - 1 >= segs[0].from && all[primaryEnd - 1].kind === "dash";
      const allNonEmpty = segs.every((s) => s.to > s.from);
      // Split the chain only when EVERY segment is a nameable ingredient — the
      // catalog (or a head-noun fragment) flanks each "oder". A bare-descriptor
      // segment ("20 oz. fresh") keeps the line whole (its descriptors share the
      // head noun of a sibling). Replaces the old primary-only headless guard.
      const allIngredientLike = segs.every((s) =>
        fragmentIsIngredientLike(source, all, s.from, s.to, opts),
      );
      if (allNonEmpty && !endsWithDash && allIngredientLike) {
        // ... existing body unchanged ...
```

- [ ] **Step 2: Run the suite**

Run: `npx vitest run tests/recipe-import-matching.test.ts tests/recipe-import.test.ts tests/recipe-import.familywall-golden.test.ts tests/recipe-import.parity.test.ts`
Expected: PASS. Investigate any failure: it is either a real regression (fix the predicate) or a deliberate change (rewrite the test with a justification). The tortellini tests (`recipe-import-matching.test.ts:1825`) and shiitake tests must stay green.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(parser): or-chain splits only when both sides are ingredient-like"
```

---

## Task 4: Drive the conjunction split on the predicate

**Files:**
- Modify: `src/lib/recipe-import/ast/segment-line.ts` (`conjunctionSplit`, ~lines 1094-1180)

Replace the `isColorAdjective` adjacency guard with the symmetric ingredient-like check on the fragments flanking each conjunction separator. Keep the structural guards (container, comma, dash, known-multiword-overlap). Colors are already in `STANDALONE_DESCRIPTOR_NAMES`, so a color-only fragment is correctly "not ingredient-like".

- [ ] **Step 1: Replace the color guard in the `seps` filter**

```ts
  const commaIdx = firstTopComma(all, from, to, depth);
  const seps = conjSeparators(all, from, to, depth, opts.unitTokens).filter((sep) => {
    if (commaIdx >= 0 && sep.at > commaIdx) return false;        // prep, not ingredients
    if (all[sep.at - 1]?.kind === "dash") return false;          // dash-compound stem
    // Split only when BOTH flanking fragments are nameable ingredients. A
    // descriptor/color-only side ("yellow", "gelbe") shares the downstream noun
    // → not a split. Replaces the dedicated isColorAdjective guard.
    const leftLike = fragmentIsIngredientLike(source, all, from, sep.at, opts);
    const rightLike = fragmentIsIngredientLike(source, all, sep.at + sep.span, to, opts);
    return leftLike && rightLike;
  });
```

- [ ] **Step 2: Run the suite**

Run: `npx vitest run tests/recipe-import-matching.test.ts tests/recipe-import.test.ts tests/recipe-import.familywall-golden.test.ts tests/recipe-import.parity.test.ts`
Expected: PASS. The color tests (`recipe-import.test.ts:920,927`) and `Salz und Pfeffer` split tests must stay green. Note: the conjunction fragments span the whole side (e.g. `from..sep.at`), so `"2 cups mixed yellow"` must read as headless — verify `"mixed"` does not register as a head noun (if it does and the test breaks, add `"mixed"`/`"gemischt"` to the descriptor set, the namer's vocabulary).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(parser): conjunction splits only when both sides are ingredient-like"
```

---

## Task 5: Retire the now-dead split guards

**Files:**
- Modify: `src/lib/recipe-import/ast/segment-line.ts` (imports + `KNOWN_PAIRS` + first-wins block)
- Modify: `src/lib/recipe-import/ingredient.ts` (export cleanup if `isColorAdjective` is now unused)

`isColorAdjective` and the `KNOWN_PAIRS` first-wins juxtaposition split are subsumed. Per the spec, bare juxtaposition (`Salz Pfeffer` with no connector) should not auto-split — but verify against the Familywall golden corpus first; if a golden line depends on it, keep `KNOWN_PAIRS` and note it.

- [ ] **Step 1: Check whether removing `KNOWN_PAIRS` breaks the golden corpus**

Run: temporarily neutralize the first-wins `KNOWN_PAIRS` block (return `single`-equivalent), then `npx vitest run tests/recipe-import.familywall-golden.test.ts`
Expected: note any failure. If green, remove the block; if red, keep `KNOWN_PAIRS` and document why in a comment.

- [ ] **Step 2: Remove `isColorAdjective` usage + dead exports**

Delete the `isColorAdjective` import in `segment-line.ts`. If `grep -rn "isColorAdjective" src/ tests/` shows no remaining callers, delete `isColorAdjective` and `COLOR_ADJECTIVE_BASES` from `ingredient.ts`.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `npx vitest run tests/recipe-import-matching.test.ts tests/recipe-import.test.ts tests/recipe-import.familywall-golden.test.ts tests/recipe-import.parity.test.ts && npx tsc --noEmit`
Expected: tests PASS; tsc shows only the pre-existing test-fixture errors on main (unrelated).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(parser): retire isColorAdjective/COLOR_ADJECTIVE_BASES split guards"
```

---

## Task 6: Verify against real prod data

**Files:** none (verification only)

- [ ] **Step 1: Run the build (dev server must be stopped first)**

Run: `lsof -ti tcp:3000 | xargs kill 2>/dev/null; npx vitest run` (full suite) then `npm run build`
Expected: full suite green; build succeeds.

- [ ] **Step 2: Diff parse output over the prod recipe set (optional, if reparse-scan is wired)**

If a reparse-scan harness exists, run it against `data/nomly-prodtest.db` and review every changed line. Any change must be an intended improvement (amount no longer stranded; descriptor folded as note) — never a lost ingredient.

---

## Self-review notes

- **Spec coverage:** Pass 2 (whole-line amounts) = Phase 1, deferred. Pass 3/4 (match + overlap) already done by `findIngredientCandidatesFromLeaves`. Pass 5 (connector split) = Tasks 3-4. Pass 6 / fallback namer already lives in `match-ingredient.ts:noMatch` (Phase 3 satisfied). Word-list disposition: `COLOR_ADJECTIVE_BASES` removed; `STANDALONE_DESCRIPTOR_NAMES`/`preIsHeadlessModifier` recast as the head-noun test; `KNOWN_PAIRS` removed pending golden check.
- **Deferred:** Phase 1 (whole-line amount annotation, structural "amounts can't be stranded") and Phase 4 (consolidate the namer into one module) are follow-ups; Phase 0 already fixed the immediate bug, so they are insurance/cleanup, not blockers.
- **Type consistency:** `fragmentIsIngredientLike(source, all, a, b, opts)` signature is used identically in Tasks 3 and 4.
