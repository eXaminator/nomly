# Coordinated Ingredient Lists + Manual "Add Ingredient" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split a single source line that names several ingredients into several rows — `und` → main rows, `oder` → alternatives — auto-generating only catalog matches, surfacing the rest as opt-in pills, plus a manual free-text "Add ingredient" control.

**Architecture:** Extend the AST segmenter (`segment-line.ts`) to detect comma-coordinated lists and route members by terminal connector. Unmatched members fold into the note and are recorded as `foldedIngredients` (parallel to `foldedAlternatives`), surfaced as `+`-pills that promote to a main via the existing `forceEmitRanges` machinery. Reparse reconciliation switches from range-keyed to label-keyed so saved/pill-added members survive a re-parse. The design spec is `docs/superpowers/specs/2026-06-13-coordinated-ingredient-lists-and-manual-add-design.md`.

**Tech Stack:** TypeScript, Next.js 16 (App Router), React, Vitest. Parser under `src/lib/recipe-import/`; editor UI under `src/components/recipes/`.

**Conventions for every task:**
- Tests live in `tests/recipe-import*.test.ts` (parser) using the `makeLookups(catalog, extraUnits?)` helper already in `tests/recipe-import-matching.test.ts`.
- Run a single test file: `npx vitest run tests/<file>.test.ts`. Full suite: `npm run test` (≈1094 tests today). `tests/familywall-api-client.test.ts` is known-flaky under load (passes in isolation).
- After ANY change touching client/server component boundaries, run `npm run build` before committing.
- Commit per green step. Commit-message footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Branch: `feat/coordinated-ingredient-lists` (already created).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/recipe-import/ast/segment-line.ts` | Line → segments | **Add** `coordinatedListSplit` branch; member role by connector |
| `src/lib/recipe-import/ast/passes/match-ingredient.ts` | Per-segment catalog match | Reuse `applyMatch`; expose a cheap `segmentMatchesCatalog`-style check if needed |
| `src/lib/recipe-import/index.ts` | Orchestrate parse, fold, force-emit | **Add** `foldedIngredients` field + push sites; reconciliation stays here |
| `src/lib/recipe-import/types.ts` (or wherever `ParsedIngredientResponse` lives) | Wire type | **Add** `foldedIngredients` |
| `src/components/recipes/types.ts` | `DraftIngredient`, `parsedIngredientToDraft` | **Add** `foldedIngredients` copy |
| `src/components/recipes/reparse.ts` | Group reparse/reconcile | **Switch** to label-keyed reconciliation; add `reparsePromotingIngredient` |
| `src/components/recipes/alternatives.ts` | Group mutators | **Add** `addMainAfter` |
| `src/components/recipes/folded-alt-chips.tsx` | Chips | **Add** `kind` prop (alternative/ingredient) → icon + title |
| `src/components/recipes/ingredient-row.tsx` | Row UI | Render ingredient pills; `onPromoteFoldedIngredient`; "Add ingredient" button; manual-row highlight |
| `src/components/recipes/section-editor.tsx` | Recipe editor surface | Wire add-main + promote-ingredient |
| `src/components/recipes/bulk-reparse-dialog.tsx` | Mass parser surface | Wire add-main + promote-ingredient; diff already index-aligned |

---

## Phase 1 — Parser: `und` comma-lists → main rows

Today `Oregano, Majoran und Basilikum nach Belieben` yields one `Oregano` row (the `und` is dropped by the comma-guard at `segment-line.ts:998`). This phase makes catalog-matching `und`-list members each their own main, with the shared trailing note on all.

### Task 1.1: Detect a coordinated `und`-list and split matched members into mains

**Files:**
- Modify: `src/lib/recipe-import/ast/segment-line.ts` (add a branch in `segmentRange` before the conjunction branch at line 501; add helper `coordinatedListSplit`)
- Test: `tests/recipe-import-matching.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/recipe-import-matching.test.ts`, add a describe block. Use `makeLookups` (already imported there). Catalog helper:

```ts
const HERBS = ["Oregano", "Majoran", "Basilikum"].map((n, i) => ({
  ingredientId: i + 1,
  canonicalName: n,
  aliasName: n,
  tokens: [n.toLowerCase()],
}));

describe("coordinated und-lists → mains", () => {
  it("splits 'Oregano, Majoran und Basilikum nach Belieben' into 3 mains sharing the note", () => {
    const out = parseIngredientLines(
      ["Oregano, Majoran und Basilikum nach Belieben"],
      makeLookups(HERBS),
    );
    expect(out.map((r) => r.name)).toEqual(["Oregano", "Majoran", "Basilikum"]);
    expect(out.every((r) => r.isAlternative !== true)).toBe(true);
    expect(out.map((r) => r.notes)).toEqual([
      "nach Belieben",
      "nach Belieben",
      "nach Belieben",
    ]);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

`npx vitest run tests/recipe-import-matching.test.ts -t "coordinated und-lists"`
Expected: FAIL — only `Oregano` returned, note `Majoran und Basilikum nach Belieben`.

- [ ] **Step 3: Implement `coordinatedListSplit` and slot it into `segmentRange`**

Add to `segment-line.ts`. The function detects: ≥1 top-level comma at `depth`, a terminal `und` (or `&`/`+`) connector joining the last two items, and each item being a bare name (no `number` leaf of its own; a shared leading amount on item 0 and a shared trailing note after the last item are allowed). It returns per-item ranges + the shared-note range, or `null`.

```ts
/** A coordinated list: "A, B und C [shared note]". Items are comma-separated,
 *  the LAST boundary is a conjunction (und/&/+) or disjunction (oder/or). Returns
 *  the item ranges, the terminal connector kind, and the trailing-note range, or
 *  null when the run is not such a list. Bare-name items only (no own number). */
type CoordinatedList = {
  items: Array<[number, number]>;
  connector: "und" | "oder";
  noteFrom: number; // index where the shared trailing note begins (== to if none)
};

function coordinatedList(
  all: readonly Leaf[],
  from: number,
  to: number,
  depth: number,
  unitTokens: ReadonlySet<string>,
): CoordinatedList | null {
  if (firstTopComma(all, from, to, depth) < 0) return null;
  // Find the terminal und/oder connector (last conj/or separator at depth).
  const ors = orSeparators(all, from, to, depth);
  const conjs = conjSeparators(all, from, to, depth, unitTokens);
  const all2 = [...ors.map((s) => ({ ...s, kind: "oder" as const })),
                ...conjs.map((s) => ({ ...s, kind: "und" as const }))]
    .sort((a, b) => a.at - b.at);
  if (all2.length === 0) return null;
  const terminal = all2[all2.length - 1];
  const connector = terminal.kind === "oder" || OR_WORDS.has(terminal.word)
    ? "oder" : "und";
  // Item boundaries: top-level commas BEFORE the terminal connector + the
  // terminal connector itself. Everything before noteFrom is the list.
  const boundaries: Array<{ at: number; span: number }> = [];
  for (let i = from; i < terminal.at; i++) {
    if (all[i].depth === depth && all[i].kind === "comma") {
      const prev = all[i - 1], next = all[i + 1];
      const decimal = prev?.kind === "number" && next?.kind === "number"
        && prev.end === all[i].start && all[i].end === next.start;
      if (!decimal) boundaries.push({ at: i, span: 1 });
    }
  }
  boundaries.push({ at: terminal.at, span: terminal.span });
  // The shared trailing note = content after the last item, up to `to`. The last
  // item ends at the first comma/note token after the terminal connector's item.
  const items: Array<[number, number]> = [];
  let start = from;
  for (const b of boundaries) { if (b.at > start) items.push([start, b.at]); start = b.at + b.span; }
  // Last item + trailing note: split the tail at its first top-level comma.
  let lastEnd = to;
  let noteFrom = to;
  const tailComma = firstTopComma(all, start, to, depth);
  if (tailComma >= 0) { lastEnd = tailComma; noteFrom = tailComma; }
  if (lastEnd > start) items.push([start, lastEnd]);
  if (items.length < 2) return null;
  // Bare-name guard: no item past item 0 may contain its own number leaf.
  for (let k = 1; k < items.length; k++) {
    for (let i = items[k][0]; i < items[k][1]; i++) {
      if (all[i].depth === depth && all[i].kind === "number") return null;
    }
  }
  return { items, connector, noteFrom };
}
```

Slot the split into `segmentRange` immediately BEFORE the `// ── "oder"/"or"/"/"/"o." chain` block (line 462), so it wins over the generic or/conj branches:

```ts
  // ── Coordinated comma-list: "A, B und C [note]" / "A, B oder C [note]" ──────
  {
    const list = coordinatedList(all, from, to, baseDepth, opts.unitTokens);
    if (list) {
      const out: LineSegment[] = [];
      const noteLeaves = list.noteFrom < to
        ? all.slice(list.noteFrom, to)
            .map((l) => ({ ...l, depth: Math.max(0, l.depth - baseDepth) }))
        : [];
      list.items.forEach(([a, b], idx) => {
        const isAlt = list.connector === "oder" && idx > 0;
        // Append the shared trailing-note leaves to each member's leaves so the
        // note renders per-row from the AST (no string append).
        const seg = makeIngredient(source, all, a, b, baseDepth, {
          rawText: source.trim(),
          forceOptional: optional,
          isAlternative: isAlt,
          connector: isAlt ? (idx === 0 ? null : "oder") : null,
          localNote: false,
          tailNote: null,
        });
        if (!seg || seg.kind !== "ingredient") return;
        if (noteLeaves.length) seg.leaves = [...seg.leaves, ...noteLeaves];
        out.push(seg);
      });
      if (out.length >= 2) return out;
    }
  }
```

> NOTE during execution: whether the shared note is best applied by appending `noteLeaves` to each member's `leaves` (so the per-segment parser renders it as that row's note) OR via the existing `applyConjunctionNotePropagation` in `index.ts` will be settled by Task 1.2's test. Start with appended leaves; if note rendering double-counts, fall back to propagation and drop the append. Keep whichever makes both 1.1 and 1.2 green.

- [ ] **Step 4: Run the test**

`npx vitest run tests/recipe-import-matching.test.ts -t "coordinated und-lists"` → PASS.

- [ ] **Step 5: Guard regressions — run neighbouring parser tests**

`npx vitest run tests/recipe-import.test.ts tests/recipe-import-matching.test.ts`
Expected: PASS. If `Zwiebel, gewürfelt` or `Salz und Pfeffer` style tests fail, the bare-name/terminal-connector guards need tightening (a list with NO terminal und/oder must return null; a single comma with a non-name tail like `gewürfelt` must not split — `gewürfelt` is one bare word so the bare-name guard alone won't reject it: ensure `coordinatedList` returns null when there is no `und`/`oder` separator at all, which `all2.length === 0` already does).

- [ ] **Step 6: Commit**

```bash
git add src/lib/recipe-import/ast/segment-line.ts tests/recipe-import-matching.test.ts
git commit -m "feat(recipe-import): split coordinated 'A, B und C' lists into mains"
```

### Task 1.2: Unmatched `und`-members fold + become `foldedIngredients`

**Files:**
- Modify: `src/lib/recipe-import/index.ts` (add `foldedIngredients` to `ImportedIngredient` ~line 96; push it in the fold branches alongside `foldedAlternatives`, but only for NON-alternative members)
- Test: `tests/recipe-import-matching.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("folds an unmatched und-member and records it as a potential ingredient", () => {
  // Only Oregano + Basilikum in the catalog; Schabziger absent.
  const cat = [
    { ingredientId: 1, canonicalName: "Oregano", aliasName: "Oregano", tokens: ["oregano"] },
    { ingredientId: 2, canonicalName: "Basilikum", aliasName: "Basilikum", tokens: ["basilikum"] },
  ];
  const out = parseIngredientLines(
    ["Oregano, Schabziger und Basilikum"],
    makeLookups(cat),
  );
  expect(out.map((r) => r.name)).toEqual(["Oregano", "Basilikum"]);
  const folded = out[0].foldedIngredients ?? [];
  expect(folded.map((f) => f.label)).toContain("Schabziger");
});
```

- [ ] **Step 2: Run to confirm it fails**

`npx vitest run tests/recipe-import-matching.test.ts -t "potential ingredient"`
Expected: FAIL — either Schabziger emitted as a main, or `foldedIngredients` undefined.

- [ ] **Step 3: Implement**

(a) In `index.ts`, add to `ImportedIngredient` (after `foldedAlternatives`, ~line 96):

```ts
  /** Coordinated-list members ("A und B") that didn't match the catalog — folded
   *  into THIS row's note and offered as "+ add ingredient" pills. Mirrors
   *  foldedAlternatives but promotes to a MAIN, not an alternative. Transient. */
  foldedIngredients?: { range: SourceRange; label: string }[];
```

(b) The coordinated-list members carry `isAlternative: false`. An unmatched non-alternative member must fold like the unmatched-alternative branch (`index.ts:853`), but push onto `foldedIngredients` and route to the first main of the line. In the orchestrator's per-segment loop, add — alongside the existing unmatched-alternative fold — a branch for an unmatched, NON-synthetic, NON-alternative member that belongs to a coordinated list:

```ts
  // Unmatched coordinated-list MAIN member → fold + offer as an ingredient pill.
  if (
    !seg.isAlternative &&
    seg.fromCoordinatedList &&            // new flag set by coordinatedListSplit
    !astSeg.matched &&
    !seg.syntheticSource &&
    lineFirstMainIndex !== null &&
    !rangeIn(seg.range, options.forceEmitRanges)
  ) {
    foldAlternativeOntoRows(
      originalTrimmed, out, foldTargets,
      lineFirstMainIndex, lineFirstMainIndex,
      seg.connectorLeaves ?? [], seg.leaves, sourceRange,
    );
    if (seg.range && astSeg.name.trim().length > 0) {
      (out[lineFirstMainIndex].foldedIngredients ??= []).push({
        range: seg.range, label: astSeg.name,
      });
    }
    continue;
  }
```

(c) Add `fromCoordinatedList?: boolean` to the `LineSegment` ingredient variant in `segment-line.ts`, set `true` on members produced by the coordinated-list branch (both und + oder), and thread it through `makeIngredient`'s `meta`. (Without this flag, a plain `Salz und Pfeffer` member that fails to match would wrongly fold instead of emitting as a "new" main — preserve current behaviour for non-coordinated lines.)

> NOTE: a coordinated-list member with NO catalog match but a non-empty name is what we fold. A `Salz und Pfeffer` member that doesn't match still emits as a `new` main today; the `fromCoordinatedList` flag is what distinguishes "list member" (fold + pill) from "conjunction main" (emit as new). Confirm via Task 1.3 that `Salz und Pfeffer` with an empty catalog still yields two mains.

- [ ] **Step 4: Run the test** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipe-import/index.ts src/lib/recipe-import/ast/segment-line.ts tests/recipe-import-matching.test.ts
git commit -m "feat(recipe-import): fold unmatched coordinated members as foldedIngredients"
```

### Task 1.3: Lock in the non-regression cases

**Files:** Test: `tests/recipe-import-matching.test.ts`

- [ ] **Step 1: Write tests asserting unchanged behaviour**

```ts
it("leaves 'Zwiebel, gewürfelt' as one main with a note (no terminal und/oder)", () => {
  const out = parseIngredientLines(["Zwiebel, gewürfelt"], makeLookups(
    [{ ingredientId: 1, canonicalName: "Zwiebel", aliasName: "Zwiebel", tokens: ["zwiebel"] }],
  ));
  expect(out).toHaveLength(1);
  expect(out[0].name).toBe("Zwiebel");
  expect(out[0].notes).toBe("gewürfelt");
});

it("keeps the bare 'Salz und Pfeffer' two-main split (no comma)", () => {
  const out = parseIngredientLines(["Salz und Pfeffer nach Geschmack"], makeLookups([]));
  expect(out.map((r) => r.name)).toEqual(["Salz", "Pfeffer"]);
  expect(out.map((r) => r.notes)).toEqual(["nach Geschmack", "nach Geschmack"]);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/recipe-import-matching.test.ts` → PASS. Fix guards if not.

- [ ] **Step 3: Commit**

```bash
git add tests/recipe-import-matching.test.ts
git commit -m "test(recipe-import): pin non-regression cases for coordinated lists"
```

---

## Phase 2 — Parser: `oder` comma-lists → alternatives

`Paprika, rot oder gelb` and `Dill, Petersilie oder Schnittlauch` must route members through the alternative path: first item primary, rest alternatives (matched → alternative rows, unmatched → `foldedAlternatives` chips). The `coordinatedList` helper from Phase 1 already returns `connector: "oder"`; the split branch already sets `isAlternative` for `oder`. This phase verifies + fixes the alternative classification and chip path.

### Task 2.1: `oder` comma-list yields primary + alternatives

**Files:**
- Modify: `src/lib/recipe-import/ast/segment-line.ts` (the coordinated branch already differentiates; ensure connector labels/`localNote` match the existing or-chain branch so `index.ts` folds unmatched ones)
- Test: `tests/recipe-import-matching.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("routes 'Dill, Petersilie oder Schnittlauch' to primary + alternatives", () => {
  const cat = ["Dill", "Petersilie", "Schnittlauch"].map((n, i) => ({
    ingredientId: i + 1, canonicalName: n, aliasName: n, tokens: [n.toLowerCase()],
  }));
  const out = parseIngredientLines(["Dill, Petersilie oder Schnittlauch"], makeLookups(cat));
  expect(out.map((r) => r.name)).toEqual(["Dill", "Petersilie", "Schnittlauch"]);
  expect(out.map((r) => r.isAlternative ?? false)).toEqual([false, true, true]);
});

it("folds unmatched 'rot'/'gelb' from 'Paprika, rot oder gelb' as alternative chips", () => {
  const cat = [{ ingredientId: 1, canonicalName: "Paprika", aliasName: "Paprika", tokens: ["paprika"] }];
  const out = parseIngredientLines(["Paprika, rot oder gelb"], makeLookups(cat));
  expect(out.map((r) => r.name)).toEqual(["Paprika"]);
  const labels = (out[0].foldedAlternatives ?? []).map((f) => f.label);
  expect(labels).toEqual(expect.arrayContaining(["rot", "gelb"]));
});
```

- [ ] **Step 2: Run** → expect FAIL (today `Paprika, rot oder gelb` keeps `rot oder gelb` as a plain note; `foldedAlternatives` empty).

- [ ] **Step 3: Implement**

In the coordinated-list branch, for `connector === "oder"`, set member `meta` to match the existing or-chain branch (`segment-line.ts:486-493`): `isAlternative: idx > 0`, `connector: idx > 0 ? "oder" : null`, `forceOptional: idx === 0 ? optional : true`, and DO NOT set `fromCoordinatedList` for the fold-as-ingredient path (these fold as ALTERNATIVES via the existing `index.ts:853` branch). Because `index.ts:853` already folds unmatched alternatives into `foldedAlternatives`, no `index.ts` change is needed — only ensure the segments reach that branch (non-synthetic, `isAlternative: true`, `lastPrimaryIndex` set).

- [ ] **Step 4: Run** both Task 2.1 tests → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipe-import/ast/segment-line.ts tests/recipe-import-matching.test.ts
git commit -m "feat(recipe-import): coordinated 'oder' lists become alternatives"
```

### Task 2.2: Pin `oder`-without-comma unchanged

- [ ] **Step 1: Test** that `Dill oder Petersilie` (no comma) still yields `Dill` primary + `Petersilie` alternative (existing behaviour) and is not affected by `coordinatedList` (returns null with no comma).

```ts
it("leaves bare 'Dill oder Petersilie' (no comma) as primary + alternative", () => {
  const cat = ["Dill", "Petersilie"].map((n, i) => ({
    ingredientId: i + 1, canonicalName: n, aliasName: n, tokens: [n.toLowerCase()] }));
  const out = parseIngredientLines(["Dill oder Petersilie"], makeLookups(cat));
  expect(out.map((r) => r.name)).toEqual(["Dill", "Petersilie"]);
  expect(out.map((r) => r.isAlternative ?? false)).toEqual([false, true]);
});
```

- [ ] **Step 2: Run** → PASS. **Step 3: Commit.**

```bash
git add tests/recipe-import-matching.test.ts
git commit -m "test(recipe-import): pin bare oder (no comma) behaviour"
```

---

## Phase 3 — Plumb `foldedIngredients` to the draft rows

`foldedIngredients` exists on `ImportedIngredient` (Task 1.2). Carry it, like `foldedAlternatives`, through the wire type and `parsedIngredientToDraft`.

### Task 3.1: Add the field to the wire + draft types and copy it

**Files:**
- Modify: `src/components/recipes/types.ts` — `ParsedIngredientResponse` (~line 189), `DraftIngredient` (~line 52), `parsedIngredientToDraft` (~line 305)
- Modify: wherever `ImportedIngredient` → response is serialized (the reparse route `src/app/api/v1/ingredients/reparse/route.ts` and the import endpoint) — confirm `foldedIngredients` is included (passthrough; add if a field allowlist exists)
- Test: `tests/recipe-import-matching.test.ts` already asserts `foldedIngredients` on parser output (Task 1.2). Add a draft-mapping unit test.

- [ ] **Step 1: Write the failing test**

Create `tests/parsed-ingredient-to-draft.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsedIngredientToDraft } from "@/components/recipes/types";

describe("parsedIngredientToDraft", () => {
  it("copies foldedIngredients through to the draft", () => {
    const draft = parsedIngredientToDraft({
      quantity: null, unit: null, unitMatch: "empty", rawUnit: null,
      name: "Oregano", ingredientId: 1, ingredientMatch: "existing",
      canonicalIngredientName: "Oregano", notes: null,
      foldedIngredients: [{ range: [10, 20], label: "Schabziger" }],
    } as never);
    expect(draft.foldedIngredients).toEqual([{ range: [10, 20], label: "Schabziger" }]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/parsed-ingredient-to-draft.test.ts` → FAIL (TS: field missing).

- [ ] **Step 3: Implement**

`ParsedIngredientResponse` (after `foldedAlternatives`):

```ts
  foldedIngredients?: { range: [number, number]; label: string }[];
```

`DraftIngredient` (after `foldedAlternatives`):

```ts
  /** Coordinated-list members that didn't match — "+ add ingredient" pills.
   *  Clicking re-parses with that range emitted as a MAIN. Parse-session only. */
  foldedIngredients?: { range: [number, number]; label: string }[];
```

`parsedIngredientToDraft` (after the `foldedAlternatives:` line ~305):

```ts
    foldedIngredients: i.foldedIngredients,
```

- [ ] **Step 4: Run** → PASS. Also run `npm run build` (type-checks the boundary). Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/recipes/types.ts tests/parsed-ingredient-to-draft.test.ts src/app/api/v1/ingredients/reparse/route.ts
git commit -m "feat(recipe-import): carry foldedIngredients to draft rows"
```

---

## Phase 4 — Pills UI: promote a folded ingredient to a main

### Task 4.1: `addMainAfter` group mutator

**Files:**
- Modify: `src/components/recipes/alternatives.ts`
- Test: `tests/alternatives.test.ts` (create if absent; mirror existing alternative-helper tests if present)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { addMainAfter } from "@/components/recipes/alternatives";
import { emptyIngredient } from "@/components/recipes/types";

describe("addMainAfter", () => {
  it("inserts a new main row after the group containing idx", () => {
    const a = { ...emptyIngredient(), name: "Salz", rawText: "Salz und Pfeffer" };
    const b = { ...emptyIngredient(), name: "Pfeffer", rawText: "Salz und Pfeffer" };
    const c = { ...emptyIngredient(), name: "Mehl" };
    const out = addMainAfter([a, b, c], 0);
    expect(out).toHaveLength(4);
    expect(out[2].isAlternative).toBe(false);
    expect(out[2].name).toBe(""); // fresh empty main
    expect(out[3].name).toBe("Mehl");
  });
});
```

- [ ] **Step 2: Run** → FAIL (no `addMainAfter`).

- [ ] **Step 3: Implement** in `alternatives.ts`:

```ts
/** Insert a fresh empty MAIN row immediately after the group containing
 *  `afterIdx`. Carries no rawText (a manual, non-reparsable addition). */
export function addMainAfter(
  rows: readonly DraftIngredient[],
  afterIdx: number,
): DraftIngredient[] {
  const primaryIdx = findPrimaryIndex(rows, afterIdx);
  const insertAt = lastInGroup(rows, primaryIdx) + 1;
  const next = rows.slice();
  next.splice(insertAt, 0, emptyIngredient());
  return next;
}
```

Add `import { emptyIngredient } from "./types";` (alongside the existing `emptyAlternative` import).

- [ ] **Step 4: Run** → PASS. **Step 5: Commit.**

```bash
git add src/components/recipes/alternatives.ts tests/alternatives.test.ts
git commit -m "feat(recipes): addMainAfter group mutator"
```

### Task 4.2: `reparsePromotingIngredient`

**Files:**
- Modify: `src/components/recipes/reparse.ts`
- Test: covered by integration in Phase 6; add a focused unit test mocking `fetch` if a pattern exists, else verify via the existing reparse e2e tests.

- [ ] **Step 1: Implement** a thin wrapper next to `reparsePromotingAlternative`:

```ts
/** Promote a folded INGREDIENT (a "+ add ingredient" pill) to its own MAIN row:
 *  re-parse the primary's line with that range force-emitted. Because the
 *  segment's role is a coordinated-list MAIN member (isAlternative: false), the
 *  emitted row is a main, not an alternative (see index.ts force-emit). */
export async function reparsePromotingIngredient(
  ingredients: readonly DraftIngredient[],
  primaryIndex: number,
  range: Range,
): Promise<DraftIngredient[] | null> {
  if (!ingredients[primaryIndex]?.rawText?.trim()) return null;
  return reparseGroupWithChange(ingredients, primaryIndex, { emit: range });
}
```

> This is identical to `reparsePromotingAlternative` because emit-vs-role is decided by the parser (the segment's `isAlternative`). If they stay identical, KEEP one function and pass a label; do not duplicate. During execution: if `reparsePromotingAlternative` already does exactly this, reuse it and skip adding a new function — wire the pill to the existing promote handler. The pill vs chip difference is purely the parser's segment role.

- [ ] **Step 2: Verify** with `npx vitest run tests/` reparse suites green. **Step 3: Commit** (only if a new function was added).

### Task 4.3: `FoldedAltChips` gains a `kind` (alternative | ingredient)

**Files:**
- Modify: `src/components/recipes/folded-alt-chips.tsx`
- Test: `tests/folded-alt-chips.test.tsx` (React Testing Library if configured; else assert via a render smoke test in an existing component test file)

- [ ] **Step 1: Write the failing test** (RTL):

```tsx
import { render, screen } from "@testing-library/react";
import { FoldedAltChips } from "@/components/recipes/folded-alt-chips";

it("renders a Plus icon and ingredient title for kind=ingredient", () => {
  render(
    <FoldedAltChips
      kind="ingredient"
      folded={[{ range: [0, 5], label: "Majoran" }]}
      onPromote={() => {}}
    />,
  );
  const btn = screen.getByRole("button", { name: /Majoran/ });
  expect(btn.getAttribute("title")).toMatch(/Zutat/); // "… als Zutat anlegen"
});
```

- [ ] **Step 2: Run** → FAIL (no `kind` prop).

- [ ] **Step 3: Implement** — add the prop and branch icon/title:

```tsx
import { CornerDownRight, Plus } from "lucide-react";

export function FoldedAltChips({
  folded,
  onPromote,
  kind = "alternative",
}: {
  folded?: { range: [number, number]; label: string }[];
  onPromote: (range: [number, number]) => void;
  kind?: "alternative" | "ingredient";
}) {
  if (!folded || folded.length === 0) return null;
  const Icon = kind === "ingredient" ? Plus : CornerDownRight;
  const title = (label: string) =>
    kind === "ingredient"
      ? `„${label}“ als Zutat anlegen`
      : `„${label}“ als Alternative anlegen`;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {folded.map((f, i) => (
        <button
          key={`${f.range[0]}-${f.range[1]}-${i}`}
          type="button"
          onClick={() => onPromote(f.range)}
          title={title(f.label)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-dashed",
            "border-muted-foreground/40 px-2 py-0.5 text-xs text-muted-foreground",
            "transition-colors hover:border-foreground/60 hover:text-foreground",
          )}
        >
          <Icon className="size-3" />
          {f.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit.**

```bash
git add src/components/recipes/folded-alt-chips.tsx tests/folded-alt-chips.test.tsx
git commit -m "feat(recipes): FoldedAltChips kind=ingredient (+ icon)"
```

### Task 4.4: Render ingredient pills in `ingredient-row.tsx` + thread `onPromoteFoldedIngredient`

**Files:**
- Modify: `src/components/recipes/ingredient-row.tsx` (next to the existing `FoldedAltChips` at ~line 659; add prop `onPromoteFoldedIngredient`)
- Modify: `src/components/recipes/section-editor.tsx`, `src/components/recipes/bulk-reparse-dialog.tsx` (wire handler → `reparsePromotingIngredient`/`reparsePromotingAlternative`)

- [ ] **Step 1: Render the pills.** After the existing chips render:

```tsx
{onPromoteFoldedIngredient ? (
  <FoldedAltChips
    kind="ingredient"
    folded={value.foldedIngredients}
    onPromote={onPromoteFoldedIngredient}
  />
) : null}
```

Add to `Props`:

```ts
  /** Promote one of this row's folded INGREDIENTS (a "+ add ingredient" pill) to
   *  its own main row. */
  onPromoteFoldedIngredient?: (range: [number, number]) => void;
```

- [ ] **Step 2: Wire `section-editor.tsx`** — add a handler mirroring `promoteFoldedAlternative`:

```ts
async function promoteFoldedIngredient(primaryIdx: number, range: [number, number]) {
  let next: DraftIngredient[] | null = null;
  try {
    next = await reparsePromotingIngredient(section.ingredients, primaryIdx, range);
  } catch { next = null; }
  if (next) onChange({ ...section, ingredients: next });
}
```

Pass to `IngredientGroup`/`IngredientRow`: `onPromoteFoldedIngredient={(range) => promoteFoldedIngredient(g.primaryIdx, range)}`. Import `reparsePromotingIngredient` (or reuse `reparsePromotingAlternative` per Task 4.2).

- [ ] **Step 3: Wire `bulk-reparse-dialog.tsx`** — mirror `promoteFoldedAlternative(entryIdx, primaryRowIdx, range)` as `promoteFoldedIngredient`, thread `onPromoteFoldedIngredient={(range) => onPromoteFoldedIngredient(k, range)}` in the leader row and through `DraftEditList`.

- [ ] **Step 4: Build + manual smoke**

`npm run build` → clean. Then a quick dev check: parse `Oregano, Schabziger und Basilikum` and confirm the `+ Schabziger` pill renders and clicking it adds a `Schabziger` main.

- [ ] **Step 5: Commit**

```bash
git add src/components/recipes/ingredient-row.tsx src/components/recipes/section-editor.tsx src/components/recipes/bulk-reparse-dialog.tsx
git commit -m "feat(recipes): + pills promote a folded ingredient to a main"
```

---

## Phase 5 — Manual "Add ingredient" (free text + best-effort highlight)

### Task 5.1: "Add ingredient" button (both surfaces)

**Files:**
- Modify: `src/components/recipes/ingredient-row.tsx` (add a button next to "Add alternative" at ~line 848, primary rows only; prop `onAddMain`)
- Modify: `src/components/recipes/section-editor.tsx`, `src/components/recipes/bulk-reparse-dialog.tsx`

- [ ] **Step 1: Add the button.** In the action row, for a non-alternative row when `onAddMain` is provided, render a `Plus`-icon button:

```tsx
{!value.isAlternative && onAddMain ? (
  <Button
    variant="ghost" size="icon" onClick={onAddMain}
    aria-label="Zutat hinzufügen"
    title="Eine weitere Hauptzutat aus derselben Originalzeile hinzufügen."
    className="..."  // match the existing add-alternative button's grid classes
  >
    <Plus className="size-4" />
  </Button>
) : null}
```

Add `onAddMain?: () => void;` to `Props`.

- [ ] **Step 2: Wire `section-editor.tsx`:** `onAddMain={() => onChange({ ...section, ingredients: addMainAfter(section.ingredients, g.primaryIdx) })}`.

- [ ] **Step 3: Wire `bulk-reparse-dialog.tsx`:** `onAddMain={() => onMutate((rs) => addMainAfter(rs, k))}`.

- [ ] **Step 4: Build** → clean. **Step 5: Commit.**

```bash
git add src/components/recipes/ingredient-row.tsx src/components/recipes/section-editor.tsx src/components/recipes/bulk-reparse-dialog.tsx
git commit -m "feat(recipes): manual 'add ingredient' button (free-text main)"
```

### Task 5.2: Best-effort highlight of a manual name against the adjacent line

**Files:**
- Create: `src/lib/recipe-import/ast/best-effort-highlight.ts` — given a `name` and a `rawText`, return `HighlightPart[]` marking a token-aligned occurrence of `name`, or `[]`.
- Modify: `src/components/recipes/ingredient-row.tsx` — when a manual row's name changes, set `highlightParts` from this helper against the adjacent group's `rawText`.
- Test: `tests/best-effort-highlight.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { bestEffortNameHighlight } from "@/lib/recipe-import/ast/best-effort-highlight";

describe("bestEffortNameHighlight", () => {
  it("marks the name span when present in the line", () => {
    const hl = bestEffortNameHighlight("Basilikum", "Oregano, Majoran und Basilikum");
    expect(hl).toEqual([{ kind: "name", range: [21, 30] }]);
  });
  it("returns [] when the name is absent", () => {
    expect(bestEffortNameHighlight("Knoblauch", "Oregano und Majoran")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement** (case-insensitive, word-boundary aligned):

```ts
import type { HighlightPart } from "../source-ranges";

/** Best-effort: locate `name` as a case-insensitive, boundary-aligned substring
 *  of `line` and return a single name-highlight span. [] when not found. */
export function bestEffortNameHighlight(name: string, line: string): HighlightPart[] {
  const needle = name.trim();
  if (!needle) return [];
  const re = new RegExp(`(?<![\\p{L}])${escapeRegExp(needle)}(?![\\p{L}])`, "iu");
  const m = re.exec(line);
  if (!m || m.index < 0) return [];
  return [{ kind: "name", range: [m.index, m.index + m[0].length] }];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Wire in `ingredient-row.tsx`** — for a manual main (no own `rawText`, has candidates? no), when the name input changes, look up the adjacent group's `rawText` (the row directly above that has one) and set `highlightParts = bestEffortNameHighlight(name, adjacentRawText)`. This is display-only; never block input. (The exact place to compute: in the `onChange` of the name field, or a `useMemo`. Keep it cheap.)

- [ ] **Step 6: Build** → clean. **Step 7: Commit.**

```bash
git add src/lib/recipe-import/ast/best-effort-highlight.ts tests/best-effort-highlight.test.ts src/components/recipes/ingredient-row.tsx
git commit -m "feat(recipes): best-effort highlight for manual ingredient names"
```

---

## Phase 6 — Label-keyed reparse reconciliation

This is the Layer 3 change: a saved/pill-added member that matches a parser "slot" must NOT be proposed for removal on reparse; only attribute diffs surface. Today `reparseGroupWithChange` keys on `sourceRange` (lost on save).

### Task 6.1: Slot model + label-keyed reconciliation in `reparseGroupWithChange`

**Files:**
- Modify: `src/components/recipes/reparse.ts`
- Test: `tests/reparse-reconcile.test.ts` (mock `fetch` to the reparse route; or refactor the slot-matching into a pure exported function and test that directly — PREFER the pure function so no network mock is needed)

- [ ] **Step 1: Extract a pure reconciler and test it**

Add an exported pure function that, given the current group rows and the parser's clean-parse result (rows + foldedAlternatives + foldedIngredients), decides `forceEmit`/`forceFold` ranges by LABEL identity:

```ts
/** Normalize a member label for identity matching (mirrors normalizeForMatch). */
function memberKey(s: string): string {
  return s.trim().toLowerCase().replace(/[.,:;]+$/g, "");
}

export type SlotPlan = {
  forceEmit: Range[]; // fold-default slots a current row claims
  forceFold: Range[]; // emit-default slots no current row claims
  unmatchedManual: number[]; // current-row indices claiming NO slot
};

/** Reconcile current group rows to parser slots by label. `emittedSlots` are the
 *  parser's default-emitted members (clean parse rows, with range + label);
 *  `foldedSlots` are default-folded members (foldedAlternatives + foldedIngredients).
 *  `currentNames` are the current group rows' display names, in order. */
export function planSlotReconciliation(
  currentNames: string[],
  emittedSlots: { range: Range; label: string }[],
  foldedSlots: { range: Range; label: string }[],
): SlotPlan {
  const claimed = new Set<string>();
  const unmatchedManual: number[] = [];
  const bySlot = new Map<string, { range: Range; folded: boolean }>();
  for (const s of emittedSlots) bySlot.set(memberKey(s.label), { range: s.range, folded: false });
  for (const s of foldedSlots) if (!bySlot.has(memberKey(s.label)))
    bySlot.set(memberKey(s.label), { range: s.range, folded: true });
  currentNames.forEach((nm, i) => {
    const key = memberKey(nm);
    const slot = bySlot.get(key);
    if (slot && !claimed.has(key)) claimed.add(key);
    else if (!slot) unmatchedManual.push(i);
  });
  const forceEmit: Range[] = [];
  const forceFold: Range[] = [];
  for (const [key, slot] of bySlot) {
    if (claimed.has(key) && slot.folded) forceEmit.push(slot.range);
    if (!claimed.has(key) && !slot.folded) {
      // emit-default but unclaimed → only force-fold if the user explicitly
      // removed it THIS session (caller passes removed ranges); a fresh reparse
      // of a saved recipe leaves it emit-default (re-proposed). See spec Layer 3.
    }
  }
  return { forceEmit, forceFold, unmatchedManual };
}
```

Test:

```ts
import { describe, it, expect } from "vitest";
import { planSlotReconciliation } from "@/components/recipes/reparse";

describe("planSlotReconciliation", () => {
  it("force-emits a folded slot a current row claims (saved Schmackofatz)", () => {
    const plan = planSlotReconciliation(
      ["Gurke", "Schmackofatz"],
      [{ range: [0, 7], label: "Gurke" }],
      [{ range: [12, 24], label: "Schmackofatz" }],
    );
    expect(plan.forceEmit).toContainEqual([12, 24]);
    expect(plan.unmatchedManual).toEqual([]);
  });
  it("flags a current row matching no slot as manual", () => {
    const plan = planSlotReconciliation(
      ["Gurke", "Knoblauch"],
      [{ range: [0, 7], label: "Gurke" }],
      [],
    );
    expect(plan.unmatchedManual).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/reparse-reconcile.test.ts` → FAIL then PASS after adding the function.

- [ ] **Step 3: Use the planner in `reparseGroupWithChange`.** Replace the range-keyed `emitted`/`forceEmit`/`forceFold` derivation (lines 111-127) with: build `currentNames` from the group rows, `emittedSlots` from `clean` rows (name + sourceRange), `foldedSlots` from `clean[].foldedAlternatives` + `clean[].foldedIngredients`; call `planSlotReconciliation`; merge in the explicit `change` (an `emit` range adds to forceEmit; a `removeIndex` removes that row's claim → its slot becomes unclaimed → forceFold if it was emit-default). Preserve `unmatchedManual` rows by splicing them back into the rebuilt group at their relative positions.

> The positional `sourceRange ?? cleanMembers[i-start]` fallback (line 110) is replaced by label matching, which is robust to saved rows. Keep range as a tie-breaker only when two slots share a label.

- [ ] **Step 4: Run** the full reparse suite + the Phase 1-2 tests → PASS. **Step 5: Build.** **Step 6: Commit.**

```bash
git add src/components/recipes/reparse.ts tests/reparse-reconcile.test.ts
git commit -m "feat(recipes): label-keyed reparse reconciliation (slots survive save)"
```

### Task 6.2: `reparseAll`/`reparseGroupAt` preserve unclaimed manual rows

**Files:** Modify: `src/components/recipes/reparse.ts`

- [ ] **Step 1: Test** that a group rebuild via `reparseGroupAt` keeps a manual row (no slot match) — extend `tests/reparse-reconcile.test.ts` with a planner-level assertion (already covered by `unmatchedManual`); add an integration assertion if a fetch-mock harness exists.

- [ ] **Step 2: Implement** — in `reparseGroupAt`/`reparseAll`, after computing `drafts` from the parser, re-insert any current group rows whose names match no slot (use `planSlotReconciliation(...).unmatchedManual`) so manual mains are not dropped.

- [ ] **Step 3: Run** full suite + build. **Step 4: Commit.**

```bash
git add src/components/recipes/reparse.ts tests/reparse-reconcile.test.ts
git commit -m "feat(recipes): preserve manual rows across group reparse"
```

### Task 6.3: Worked-example end-to-end checks

- [ ] **Step 1: Add parser/reconcile tests** for the two request examples:
  - `1 Gurke oder Paprika` (both catalog) → two rows (`Gurke` primary, `Paprika` alternative). Deleting `Gurke` re-shows its pill (assert `foldedAlternatives` after a force-fold).
  - `1 Gurke oder Schmackofatz` → `1 Gurke` + `Schmackofatz` pill; promote → save-shape (drop `sourceRange`) → reparse → `planSlotReconciliation` force-emits `Schmackofatz` (no removal).

- [ ] **Step 2: Run** → PASS. **Step 3: Commit.**

```bash
git add tests/recipe-import-matching.test.ts tests/reparse-reconcile.test.ts
git commit -m "test(recipe-import): worked examples for coordinated lists + reconcile"
```

---

## Phase 7 — Full verification

- [ ] **Step 1:** `npm run test` — full suite green (≈1094 + new). Re-run `tests/familywall-api-client.test.ts` in isolation if it times out under load.
- [ ] **Step 2:** `npm run build` — clean (RSC boundary).
- [ ] **Step 3:** Manual dev pass against prod-test DB (per AGENTS.md): `Oregano, Majoran und Basilikum nach Belieben` splits into 3; `Paprika, rot oder gelb` shows `rot`/`gelb` as alternative chips; `Oregano, Schabziger und Basilikum` shows `+ Schabziger`; manual "Add ingredient" + reparse keeps the addition.
- [ ] **Step 4:** Push the branch and open a PR (only when the user asks).

---

## Self-Review

**Spec coverage:**
- Layer 1 (parser, connector role, catalog gate) → Phase 1 (und/mains) + Phase 2 (oder/alternatives). ✓
- Existence rule (auto-gen iff catalog match) → Tasks 1.1/1.2/2.1. ✓
- Layer 2 pills + visibility (add hides, remove re-shows) → Phase 4 (pills) + delete re-fold reuses `isConjunctionMember`/`reparseDeletingAlternative` (already routes conjunction-main deletes) → Task 6.3. ✓
- Layer 3 identity reconciliation → Phase 6. ✓
- Layer 4 manual add + best-effort highlight → Phase 5. ✓
- `foldedIngredients` plumbing → Phase 3. ✓

**Open execution risks (resolve via the NOTE callouts during TDD):**
1. Shared-note application (append leaves vs `applyConjunctionNotePropagation`) — Task 1.1 NOTE.
2. `fromCoordinatedList` flag needed so `Salz und Pfeffer` (no comma) members that miss the catalog still emit as `new` mains rather than folding — Task 1.2 NOTE.
3. `reparsePromotingIngredient` may be identical to `reparsePromotingAlternative` (role decided by parser) → reuse, don't duplicate — Task 4.2 NOTE.

**Type consistency:** `foldedIngredients: { range: [number, number]; label: string }[]` is used identically in `ImportedIngredient` (`SourceRange`), `ParsedIngredientResponse`, `DraftIngredient`. `planSlotReconciliation` / `SlotPlan` / `memberKey` names are consistent across Phase 6. `addMainAfter`, `onAddMain`, `onPromoteFoldedIngredient`, `reparsePromotingIngredient`, `bestEffortNameHighlight` are each defined once and referenced consistently.
