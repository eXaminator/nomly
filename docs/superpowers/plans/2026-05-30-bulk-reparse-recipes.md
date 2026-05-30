# Bulk Re-Parse All Recipes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A Settings-triggered modal that scans every recipe, shows only the ingredient source-lines whose current parser output differs from what's stored, lets the user opt in (per line / per recipe) and edit proposed rows, then applies the selection through the normal recipe-update path.

**Architecture:** Server scan (`reparse-scan.ts`) reads all recipes' ingredient rows, groups contiguous rows by `rawLine`, re-parses each line, and returns only changed groups. A modal reviews them (opt-in checkboxes, lazy editable `IngredientRow` groups). Apply sends per-recipe replacements; the server rebuilds each affected recipe's `RecipeInput` (substituting replaced groups, preserving `rawLine`) and calls existing `updateRecipe`. New-ingredient names route through the existing `/ingredients/check` → `NewIngredientsDialog` → `newIngredientDefaults` flow.

**Tech Stack:** TypeScript, Next.js (custom), Vitest, Drizzle/SQLite. Spec: `docs/superpowers/specs/2026-05-30-bulk-reparse-recipes-design.md`.

---

## File map
- **Create** `src/lib/recipes/reparse-scan.ts` — pure helpers (`normalizeProposedRow`, `normalizeCurrentRow`, `isLineGroupChanged`) + `scanAllRecipesForReparse(lookups?)` (reads DB, returns changed entries) + `buildReparsedRecipeInput(view, replacements)` (apply rebuild, pure given a `RecipeView`).
- **Create** `src/app/api/v1/recipes/reparse-scan/route.ts` — `POST` → `{ entries }`.
- **Create** `src/app/api/v1/recipes/reparse-apply/route.ts` — `POST` → `{ updatedRecipes, updatedGroups, skipped }`.
- **Create** `src/components/recipes/bulk-reparse-dialog.tsx` — the modal (client).
- **Create** `src/components/recipes/bulk-reparse-button.tsx` — client button that mounts the dialog (so the server Settings page stays a server component).
- **Modify** `src/app/(app)/einstellungen/page.tsx` — render the button in a maintenance area.
- **Tests:** `tests/reparse-scan.test.ts` (change-detection + grouping + rebuild).

## Shared types (define in `reparse-scan.ts`, import in routes + client)
```ts
export type ScanRowSummary = {
  name: string;
  canonicalName: string | null;
  quantity: number | null;
  unitLabel: string | null;
  notes: string | null;
  isOptional: boolean;
  isAlternative: boolean;
};
export type ReparseScanEntry = {
  recipeId: number;
  title: string;
  sectionId: number;
  rawLine: string;
  currentRowIds: number[];
  current: ScanRowSummary[];
  proposed: ParsedIngredientResponse[]; // from @/components/recipes/types
};
```

---

### Task 1: Change-detection helper (TDD)

**Files:** Create `src/lib/recipes/reparse-scan.ts`; Test `tests/reparse-scan.test.ts`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { isLineGroupChanged } from "@/lib/recipes/reparse-scan";
import type { ParsedIngredientResponse } from "@/components/recipes/types";

function cur(over: Partial<import("@/lib/recipes/reparse-scan").CurrentRow> = {}) {
  return {
    id: 1, ingredientId: 5, name: "Tomate", quantity: 2, unitId: 3,
    subUnitId: null, notes: null, isOptional: false, alternativeForId: null,
    ...over,
  };
}
function prop(over: Partial<ParsedIngredientResponse> = {}): ParsedIngredientResponse {
  return {
    quantity: 2, unit: { id: 3, name: "g" }, subUnit: null, unitMatch: "matched",
    rawUnit: null, name: "Tomate", ingredientId: 5, canonicalIngredientName: null,
    notes: null, isOptional: false, fixedAmount: false, isAlternative: false,
    rawText: "2 g Tomate", candidateMatches: [], newNameProposals: [],
    ...over,
  } as ParsedIngredientResponse;
}

describe("isLineGroupChanged", () => {
  it("false when identical", () => {
    expect(isLineGroupChanged([cur()], [prop()])).toBe(false);
  });
  it("true when ingredient mapping differs", () => {
    expect(isLineGroupChanged([cur({ ingredientId: 5 })], [prop({ ingredientId: 9 })])).toBe(true);
  });
  it("true when name differs", () => {
    expect(isLineGroupChanged([cur({ name: "Tomate" })], [prop({ name: "Tomaten" })])).toBe(true);
  });
  it("treats null and empty notes as equal", () => {
    expect(isLineGroupChanged([cur({ notes: null })], [prop({ notes: "" })])).toBe(false);
  });
  it("true when notes differ", () => {
    expect(isLineGroupChanged([cur({ notes: "fein" })], [prop({ notes: "grob" })])).toBe(true);
  });
  it("true when quantity differs, false within epsilon", () => {
    expect(isLineGroupChanged([cur({ quantity: 2 })], [prop({ quantity: 3 })])).toBe(true);
    expect(isLineGroupChanged([cur({ quantity: 2 })], [prop({ quantity: 2.0000001 })])).toBe(false);
  });
  it("true when unit / sub-unit differ", () => {
    expect(isLineGroupChanged([cur({ unitId: 3, subUnitId: null })], [prop({ unit: { id: 4, name: "ml" }, subUnit: null })])).toBe(true);
    expect(isLineGroupChanged([cur({ unitId: 3, subUnitId: null })], [prop({ unit: null, subUnit: { id: 7, name: "Zehe" } } as Partial<ParsedIngredientResponse>)])).toBe(true);
  });
  it("true when optional / alternative flags differ", () => {
    expect(isLineGroupChanged([cur({ isOptional: false })], [prop({ isOptional: true })])).toBe(true);
    expect(isLineGroupChanged([cur({ alternativeForId: null })], [prop({ isAlternative: true })])).toBe(true);
  });
  it("true when row counts differ", () => {
    expect(isLineGroupChanged([cur()], [prop(), prop({ name: "Margarine" })])).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect fail** — `npm test -- tests/reparse-scan.test.ts -t isLineGroupChanged` → FAIL (module/export missing).

- [ ] **Step 3: Implement**

```ts
import type { ParsedIngredientResponse } from "@/components/recipes/types";

export type CurrentRow = {
  id: number;
  ingredientId: number | null;
  name: string;
  quantity: number | null;
  unitId: number | null;
  subUnitId: number | null;
  notes: string | null;
  isOptional: boolean;
  alternativeForId: number | null;
};

const QTY_EPSILON = 1e-4;

function normNotes(n: string | null | undefined): string {
  return (n ?? "").trim();
}
function qtyEqual(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < QTY_EPSILON;
}

function currentKey(r: CurrentRow): string {
  return JSON.stringify([
    r.ingredientId ?? null,
    r.name.trim(),
    normNotes(r.notes),
    r.unitId ?? null,
    r.subUnitId ?? null,
    r.isOptional,
    r.alternativeForId != null,
  ]);
}
function proposedKey(p: ParsedIngredientResponse): string {
  return JSON.stringify([
    p.ingredientId ?? null,
    p.name.trim(),
    normNotes(p.notes),
    p.unit?.id ?? null,
    p.subUnit?.id ?? null,
    p.isOptional ?? false,
    p.isAlternative ?? false,
  ]);
}

/** True when the freshly parsed rows differ from the current rows on any
 *  meaningful field (mapping, name, notes, qty, unit/sub-unit, optional,
 *  alternative) or in count. Quantity is compared separately (epsilon). */
export function isLineGroupChanged(
  current: CurrentRow[],
  proposed: ParsedIngredientResponse[],
): boolean {
  if (current.length !== proposed.length) return true;
  for (let i = 0; i < current.length; i++) {
    if (currentKey(current[i]) !== proposedKey(proposed[i])) return true;
    if (!qtyEqual(current[i].quantity, proposed[i].quantity)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run, expect pass** — same command → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/recipes/reparse-scan.ts tests/reparse-scan.test.ts && git commit -m "feat(recipes): change-detection for bulk re-parse"`

---

### Task 2: Scan all recipes (DB read + grouping)

**Files:** Modify `src/lib/recipes/reparse-scan.ts`; Test `tests/reparse-scan.test.ts`.

- [ ] **Step 1:** Add `scanAllRecipesForReparse()`. It reads every recipe + its ingredient rows in one query set, groups contiguous rows per `(sectionId)` by equal non-empty `rawLine`, re-parses each line with `parseIngredientLines([rawLine], lookups)`, keeps only `isLineGroupChanged` groups, and returns `ReparseScanEntry[]`. Build lookups once via `buildUnitLookup/buildIngredientLookup/buildIngredientCatalog/buildSubUnitLookup` from `@/lib/recipe-import`.

```ts
import { db } from "@/db";
import { recipe, recipeSection, recipeIngredient, ingredient, unit, ingredientSubUnit } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import {
  buildIngredientCatalog, buildIngredientLookup, buildSubUnitLookup,
  buildUnitLookup, parseIngredientLines,
} from "@/lib/recipe-import";
import { parsedIngredientToImportedResponse } from "@/lib/recipe-import"; // if exists; else cast ImportedIngredient

export function scanAllRecipesForReparse(): ReparseScanEntry[] {
  const lookups = {
    units: buildUnitLookup(), ingredients: buildIngredientLookup(),
    ingredientCatalog: buildIngredientCatalog(), subUnits: buildSubUnitLookup(),
  };
  // rows: every ingredient with its recipe + section + current fields, ordered.
  const rows = db.select({
      recipeId: recipe.id, title: recipe.title,
      sectionId: recipeSection.id, sectionSort: recipeSection.sortOrder,
      id: recipeIngredient.id, sortOrder: recipeIngredient.sortOrder,
      ingredientId: recipeIngredient.ingredientId,
      name: recipeIngredient.displayName,
      canonicalName: ingredient.name,
      quantity: recipeIngredient.quantity,
      unitId: recipeIngredient.unitId, unitName: unit.name,
      subUnitId: recipeIngredient.subUnitId, subUnitName: ingredientSubUnit.name,
      notes: recipeIngredient.notes,
      isOptional: recipeIngredient.isOptional,
      alternativeForId: recipeIngredient.alternativeForId,
      rawLine: recipeIngredient.rawLine,
    })
    .from(recipeIngredient)
    .innerJoin(recipeSection, eq(recipeSection.id, recipeIngredient.sectionId))
    .innerJoin(recipe, eq(recipe.id, recipeSection.recipeId))
    .leftJoin(ingredient, eq(ingredient.id, recipeIngredient.ingredientId))
    .leftJoin(unit, eq(unit.id, recipeIngredient.unitId))
    .leftJoin(ingredientSubUnit, eq(ingredientSubUnit.id, recipeIngredient.subUnitId))
    .orderBy(asc(recipe.id), asc(recipeSection.sortOrder), asc(recipeSection.id), asc(recipeIngredient.sortOrder))
    .all();

  const entries: ReparseScanEntry[] = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    const rawLine = (r.rawLine ?? "").trim();
    if (!rawLine) { i++; continue; }
    // contiguous run within the same section sharing this rawLine
    let j = i;
    const group: typeof rows = [];
    while (
      j < rows.length && rows[j].sectionId === r.sectionId &&
      (rows[j].rawLine ?? "").trim() === rawLine
    ) { group.push(rows[j]); j++; }
    const current: CurrentRow[] = group.map((g) => ({
      id: g.id, ingredientId: g.ingredientId, name: g.name,
      quantity: g.quantity, unitId: g.unitId, subUnitId: g.subUnitId,
      notes: g.notes, isOptional: g.isOptional, alternativeForId: g.alternativeForId,
    }));
    const proposed = parseIngredientLines([rawLine], lookups) as unknown as ParsedIngredientResponse[];
    if (proposed.length > 0 && isLineGroupChanged(current, proposed)) {
      entries.push({
        recipeId: r.recipeId, title: r.title, sectionId: r.sectionId, rawLine,
        currentRowIds: group.map((g) => g.id),
        current: group.map((g) => ({
          name: g.name, canonicalName: g.canonicalName ?? null, quantity: g.quantity,
          unitLabel: g.subUnitName ?? g.unitName ?? null, notes: g.notes,
          isOptional: g.isOptional, isAlternative: g.alternativeForId != null,
        })),
        proposed,
      });
    }
    i = j;
  }
  return entries;
}
```
> Note: `parseIngredientLines` returns `ImportedIngredient[]`, which is the JSON shape `ParsedIngredientResponse` mirrors; the cast is sound (same fields). Confirm field parity while implementing; if `ImportedIngredient` is already exported with those fields, import the type instead of casting.

- [ ] **Step 2: Test grouping** — add a test that builds a tiny in-memory recipe via the existing test DB helpers (or, if scanning needs the real DB, cover grouping logic by extracting `groupContiguousByRawLine(rows)` as a pure exported function and testing it directly). Prefer extracting the pure grouping function and unit-testing it with synthetic rows (no DB).

```ts
import { groupContiguousByRawLine } from "@/lib/recipes/reparse-scan";
it("groups contiguous same-rawLine rows within a section, skips empty rawLine", () => {
  const rows = [
    { sectionId: 1, id: 10, rawLine: "a" }, { sectionId: 1, id: 11, rawLine: "a" },
    { sectionId: 1, id: 12, rawLine: "" },
    { sectionId: 1, id: 13, rawLine: "b" },
    { sectionId: 2, id: 14, rawLine: "a" },
  ];
  const groups = groupContiguousByRawLine(rows);
  expect(groups.map((g) => g.map((r) => r.id))).toEqual([[10, 11], [13], [14]]);
});
```
Refactor the scan loop to call `groupContiguousByRawLine`.

- [ ] **Step 3:** Run `npm test -- tests/reparse-scan.test.ts` → PASS. **Commit.**

---

### Task 3: Scan endpoint

**Files:** Create `src/app/api/v1/recipes/reparse-scan/route.ts`.

- [ ] **Step 1: Implement** (no body needed; POST for non-cacheability)
```ts
import { NextResponse } from "next/server";
import { scanAllRecipesForReparse } from "@/lib/recipes/reparse-scan";
export async function POST() {
  return NextResponse.json({ entries: scanAllRecipesForReparse() });
}
```
- [ ] **Step 2:** `npm run build` clean. **Commit.**

---

### Task 4: Apply rebuild (TDD) + endpoint

**Files:** Modify `src/lib/recipes/reparse-scan.ts` (`buildReparsedRecipeInput`); Create `src/app/api/v1/recipes/reparse-apply/route.ts`; Test `tests/reparse-scan.test.ts`.

- [ ] **Step 1: Write failing test for the pure rebuild.** `buildReparsedRecipeInput(view: RecipeView, replacements: { replaceRowIds: number[]; rows: RecipeIngredientInput[] }[]): { input: RecipeInput; appliedGroups: number; skipped: number }`. It maps the view to a `RecipeInput`, replacing each matched group (first occurrence of any id in `replaceRowIds`) with `rows`, dropping the group's other rows, keeping everything else; a replacement whose ids are all absent is counted in `skipped`.

```ts
import { buildReparsedRecipeInput } from "@/lib/recipes/reparse-scan";
it("substitutes a group and preserves order + other rows", () => {
  const view = {
    id: 1, title: "R", description: null, photoPath: null, sourceUrl: null,
    servings: 2, prepTimeMin: null, cookTimeMin: null, tags: [],
    isVegan: null, isVegetarian: null, dietConfidence: "low", needsUpdate: false,
    createdAt: 0, updatedAt: 0,
    sections: [{ id: 9, title: null, instructions: "", sortOrder: 0, ingredients: [
      { id: 100, ingredientId: 5, ingredientName: "Salz", canonicalIngredientName: null,
        quantity: 1, unitId: 2, unitName: "g", subUnitId: null, subUnitPerPurchase: null,
        notes: null, isOptional: false, fixedAmount: false, rawLine: "1 g Salz",
        isEquipment: false, dietaryClass: null, sortOrder: 0, alternativeForId: null },
      { id: 101, ingredientId: 6, ingredientName: "Pfeffer", canonicalIngredientName: null,
        quantity: 1, unitId: 2, unitName: "g", subUnitId: null, subUnitPerPurchase: null,
        notes: null, isOptional: false, fixedAmount: false, rawLine: "1 g Pfeffer",
        isEquipment: false, dietaryClass: null, sortOrder: 1, alternativeForId: null },
    ]}],
  } as any;
  const { input, appliedGroups, skipped } = buildReparsedRecipeInput(view, [
    { replaceRowIds: [100], rows: [{ ingredientName: "Meersalz", ingredientId: 5,
      quantity: 2, unitId: 2, subUnitId: null, notes: "grob", isOptional: false,
      fixedAmount: false, rawLine: "1 g Salz", isAlternative: false }] },
  ]);
  expect(appliedGroups).toBe(1); expect(skipped).toBe(0);
  expect(input.sections[0].ingredients.map((x) => x.ingredientName)).toEqual(["Meersalz", "Pfeffer"]);
  expect(input.sections[0].ingredients[0].notes).toBe("grob");
});
it("counts a replacement with absent ids as skipped, leaves rows intact", () => {
  /* same view, replaceRowIds:[999] → appliedGroups 0, skipped 1, ingredients unchanged */
});
```

- [ ] **Step 2: Run, expect fail. Step 3: Implement** `buildReparsedRecipeInput`: map each `RecipeIngredientView` to a `RecipeIngredientInput` (ingredientName=ingredientName, ingredientId, unassigned: ingredientId==null, addAsAlias:false, quantity, unitId, subUnitId, displayUnit: subUnitId?null:unitName, notes, isOptional, fixedAmount, rawLine, isAlternative: alternativeForId!=null). Walk each section; when a row id matches the first id of an unused replacement group, splice in `rows`, skip that group's other current ids; else map through. Track applied/skipped. **Step 4: pass. Commit.**

- [ ] **Step 5: Endpoint** `src/app/api/v1/recipes/reparse-apply/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRecipe, updateRecipe } from "@/lib/recipes/service";
import { buildReparsedRecipeInput } from "@/lib/recipes/reparse-scan";

const rowSchema = z.object({ /* RecipeIngredientInput fields, all required-or-nullable */ }).passthrough();
const schema = z.object({
  recipes: z.array(z.object({
    recipeId: z.number().int().positive(),
    replacements: z.array(z.object({
      replaceRowIds: z.array(z.number().int()).min(1),
      rows: z.array(rowSchema),
    })).min(1),
  })).min(1),
  newIngredientDefaults: z.array(z.any()).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  let updatedRecipes = 0, updatedGroups = 0, skipped = 0;
  for (const r of parsed.data.recipes) {
    const view = getRecipe(r.recipeId);
    if (!view) { skipped += r.replacements.length; continue; }
    const { input, appliedGroups, skipped: sk } = buildReparsedRecipeInput(view, r.replacements as never);
    if (appliedGroups > 0) {
      updateRecipe(r.recipeId, { ...input, newIngredientDefaults: parsed.data.newIngredientDefaults as never });
      updatedRecipes += 1; updatedGroups += appliedGroups;
    }
    skipped += sk;
  }
  return NextResponse.json({ updatedRecipes, updatedGroups, skipped });
}
```
- [ ] **Step 6:** `npm run build` clean. **Commit.**

---

### Task 5: Dialog client helper

**Files:** Create helper functions inside `bulk-reparse-dialog.tsx` (or a small `bulk-reparse.ts`): map a selected entry's edited `DraftIngredient[]` → `RecipeIngredientInput[]` via the SAME logic as `ingredientToPayload` (extract/reuse it — move `ingredientToPayload` to a shared module `src/components/recipes/payload.ts` and import in both `recipe-form.tsx` and here, to stay DRY). Collect new names across selected entries for `/ingredients/check`.

- [ ] **Step 1:** Extract `ingredientToPayload` + `toNumberOrNull` from `recipe-form.tsx` into `src/components/recipes/payload.ts`; re-import in `recipe-form.tsx`. Run build + tests (no behavior change). **Commit.**

---

### Task 6: Bulk re-parse dialog UI

**Files:** Create `src/components/recipes/bulk-reparse-dialog.tsx`, `src/components/recipes/bulk-reparse-button.tsx`.

- [ ] **Step 1: Build the dialog.** State: `loading`, `entries: ReparseScanEntry[]`, per-entry `{ selected: boolean; draft: DraftIngredient[]; editing: boolean }` keyed by `${recipeId}:${currentRowIds.join(',')}`. On open → `POST /reparse-scan` → seed entries (draft via `entries[i].proposed.map(parsedIngredientToDraft)`, `selected:false`, `editing:false`). Group rendering by `recipeId` (recipe checkbox = all entries; indeterminate when partial). Per entry: `Original: „rawLine"`, compact current (from `entry.current`) and compact proposed (derive from `draft`), per-entry checkbox, "Bearbeiten" toggle that renders editable `IngredientRow`s for the draft (onChange updates that entry's `draft[idx]`). Footer counts + "Anwenden".
- [ ] **Step 2: Apply handler.** Gather selected entries → for each, `rows = draft.map(ingredientToPayload).filter(Boolean)`. Build new-name list = drafts with `selectedIngredientId==null && !unassigned` → `name`. `POST /ingredients/check` → if `newNames.length`, open `NewIngredientsDialog` (reuse) to get `defaults`; else `defaults=[]`. Build payload grouped by recipeId (`replacements: [{ replaceRowIds: entry.currentRowIds, rows }]`) → `POST /reparse-apply`. On success: show summary toast/text, close, and (since this lives on the settings page) leave it; recipes are updated server-side.
- [ ] **Step 3: Button** (`bulk-reparse-button.tsx`): a `"use client"` button that opens the dialog.
- [ ] **Step 4:** `npx tsc --noEmit` + `npm run build` clean. **Commit.**

---

### Task 7: Settings entry + final verification

**Files:** Modify `src/app/(app)/einstellungen/page.tsx`.

- [ ] **Step 1:** Add a "Wartung" area rendering `<BulkReparseButton />`.
- [ ] **Step 2:** `npm test` (all green) + `npm run build` (clean).
- [ ] **Step 3:** Manual browser verification (dev server): open Settings → "Alle Rezepte neu parsen" → scan lists only changed entries grouped by recipe, all unchecked → check one, edit a proposed row, Apply → (new-ingredient dialog if applicable) → recipe updated; re-open scan shows that entry gone. **Commit.**

---

## Self-review notes
- Spec §2 scan → Task 2/3. §3 change-detection → Task 1. §4 modal → Task 6. §5 new-ingredient flow → Task 6 step 2 (reuses check + NewIngredientsDialog). §6 apply → Task 4. Edge cases: empty rawLine skipped (Task 2), zero proposed rows skipped (Task 2 `proposed.length>0`), stale ids → skipped+counted (Task 4). Default-unchecked → Task 6 step 1.
- DRY: `ingredientToPayload` extracted to shared `payload.ts` (Task 5) used by form + dialog.
- Confirm during impl: `ImportedIngredient` field parity with `ParsedIngredientResponse` (prefer importing the type over casting); exact `RecipeIngredientInput` field set for the apply row schema; `RecipeView` ingredient field names used in `buildReparsedRecipeInput`.
