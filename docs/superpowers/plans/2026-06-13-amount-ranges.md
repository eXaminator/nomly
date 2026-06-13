# Amount Ranges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store ingredient amount ranges structurally (`quantity` = high, new `quantity_low` = low), render them as `low–high unit` in recipes, keep shopping using only the high bound, and give the editor a toggle (between amount and unit) that reveals an optional low-amount input.

**Architecture:** Additive nullable `quantity_low` column. The parser already computes both ends of a range; it now emits a structured low bound that threads through the import/draft/persist/read pipeline. A range exists iff `quantity_low != null`. Editor adds a `quantityLow` string + `isRange` toggle to the draft; blocking validation rejects an invalid range. Shopping/scaling are untouched (they key off the high `quantity`).

**Tech Stack:** Next.js 16, SQLite + Drizzle, Vitest, React.

---

## File structure

- `src/db/schema.ts` + `drizzle/0039_*.sql` — `quantity_low` column.
- `src/lib/recipe-import/ast/numeric.ts` — `consumeQuantity` returns the low bound.
- `src/lib/recipe-import/ast/passes/amount-unit.ts` — `AmountUnit.quantityLow`.
- `src/lib/recipe-import/ast/parse-line.ts` — `ParsedRow.quantityLow`; suppress range text in notes for structured ranges.
- `src/lib/recipe-import/index.ts` — `ImportedIngredient.quantityLow` (2 construction sites).
- `src/components/recipes/types.ts` — `ParsedIngredientResponse.quantityLow`; `DraftIngredient.{quantityLow,isRange}`; both draft builders; `emptyIngredient`.
- `src/components/recipes/payload.ts` — serialize `quantityLow`; `rangeError` helper.
- `src/lib/recipes/service.ts` — insert `quantity_low`; read model + view literals.
- `src/lib/recipes/types.ts` — `RecipeView` ingredient `quantityLow`.
- `src/components/recipes/ingredient-read-line.tsx` + `recipe-detail.tsx` — range display (shared `formatAmount`).
- `src/components/recipes/ingredient-row.tsx` — toggle + low input + inline validation.
- `src/components/recipes/recipe-form.tsx` — block save on range error.
- Tests under `tests/`.

---

## Task 1: Schema column + migration

**Files:** Modify `src/db/schema.ts`; create `drizzle/0039_*.sql`.

- [ ] **Step 1:** In `recipe_ingredient`, after `quantity: real("quantity"),` add:

```ts
    /**
     * Low bound of an amount range ("2–3 EL" → quantity=3, quantityLow=2).
     * NULL = single amount. The high bound stays in `quantity`; shopping and
     * servings scaling use only `quantity`.
     */
    quantityLow: real("quantity_low"),
```

- [ ] **Step 2:** `npm run db:generate` → expect `drizzle/0039_*.sql` adding `quantity_low`.
- [ ] **Step 3:** `npm run migrate` (and `DATABASE_URL=./data/nomly-prodtest.db npm run migrate`) → clean.
- [ ] **Step 4:** Commit: `feat(recipes): add quantity_low column (migration 0039)`.

---

## Task 2: Parser numeric low bound

**Files:** Modify `src/lib/recipe-import/ast/numeric.ts`. Test: `tests/amount-ranges-numeric.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { consumeQuantity } from "@/lib/recipe-import/ast/numeric";

describe("consumeQuantity low bound", () => {
  it("returns low bound for a real range", () => {
    expect(consumeQuantity(["2-3"])).toMatchObject({ quantity: 3, quantityLow: 2 });
  });
  it("min/max regardless of order", () => {
    expect(consumeQuantity(["100", "-", "200"])).toMatchObject({ quantity: 200, quantityLow: 100 });
  });
  it("single amount has null low", () => {
    expect(consumeQuantity(["3"])).toMatchObject({ quantity: 3, quantityLow: null });
  });
  it("open-ended 'bis' has null low", () => {
    expect(consumeQuantity(["bis", "3"])).toMatchObject({ quantity: 3, quantityLow: null });
  });
});
```

- [ ] **Step 2:** Run `npm run test -- amount-ranges-numeric` → FAIL (`quantityLow` undefined).

- [ ] **Step 3: Implement.** Add to `RangeResult`:

```ts
  /** Low bound for a true lo–hi range, else null (single or open-ended). */
  quantityLow: number | null;
```

In `consumeQuantity`, update the three returns:
- single, no bisPrefix: `return { quantity: round3(values[0]), rangeExpression: null, quantityLow: null };`
- the range branch: compute `const min = Math.min(...values);` and
  ```ts
  const quantityLow = !bisPrefix && values.length > 1 ? round3(min) : null;
  return { quantity: round3(max), rangeExpression, quantityLow };
  ```

- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit: `feat(parser): consumeQuantity returns structured range low bound`.

---

## Task 3: amount-unit pass carries the low bound

**Files:** Modify `src/lib/recipe-import/ast/passes/amount-unit.ts`. Test: `tests/amount-ranges-parse.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseSegment, type SegmentLookups } from "@/lib/recipe-import/ast/parse-line";

const lookups = (): SegmentLookups => ({
  knownUnitTokens: new Set(["el", "g", "tl"]),
  catalog: [],
});

describe("amount ranges in the parse", () => {
  it("2-3 EL → quantity 3, quantityLow 2, no range text in notes", () => {
    const r = parseSegment("2-3 EL Zucker", lookups());
    expect(r.quantity).toBe(3);
    expect(r.quantityLow).toBe(2);
    expect(r.notes ?? "").not.toContain("2-3");
  });
  it("100-200 g", () => {
    const r = parseSegment("100-200 g Mehl", lookups());
    expect(r.quantity).toBe(200);
    expect(r.quantityLow).toBe(100);
  });
  it("single amount → null low", () => {
    const r = parseSegment("3 EL Zucker", lookups());
    expect(r.quantity).toBe(3);
    expect(r.quantityLow).toBeNull();
  });
  it("open-ended 'bis 3 EL' keeps range in notes, null low", () => {
    const r = parseSegment("bis 3 EL Zucker", lookups());
    expect(r.quantity).toBe(3);
    expect(r.quantityLow).toBeNull();
    expect(r.notes ?? "").toContain("bis 3");
  });
});
```

- [ ] **Step 2:** Run `npm run test -- amount-ranges-parse` → FAIL.

- [ ] **Step 3: Implement** in `amount-unit.ts`:

Add `quantityLow` to `AmountUnit`:
```ts
  /** Low bound of a true lo–hi range, else null. */
  quantityLow: number | null;
```

Declare alongside `quantity`: `let quantityLow: number | null = null;`

In the same-unit range block (where `quantity = round3(Math.max(n1, n2));`), add right after it:
```ts
      quantityLow = round3(Math.min(n1, n2));
```

In the `consumeQuantity` branch (the `const r = consumeQuantity(work); if (r) { ... }`), add:
```ts
        quantityLow = r.quantityLow;
```

Update EVERY `return { quantity, unitName, rangeExpression }` to
`return { quantity, unitName, rangeExpression, quantityLow }` — including the
unspecific early-return, which returns `quantityLow: null`.

- [ ] **Step 4:** Run test → still FAIL on `quantityLow` until parse-line forwards it (Task 4). Run `npm run test -- amount-ranges-parse` and confirm the parse-line wiring is needed; proceed to Task 4, then re-run.

(If you prefer green-per-task: do Task 4's parse-line change before re-running. They are one logical unit.)

- [ ] **Step 5:** Commit with Task 4.

---

## Task 4: parse-line forwards low bound + suppresses range note

**Files:** Modify `src/lib/recipe-import/ast/parse-line.ts`.

- [ ] **Step 1:** Add to `ParsedRow`:
```ts
  quantityLow: number | null;
```

- [ ] **Step 2:** Update the amount-pass destructure:
```ts
  const { quantity, unitName, rangeExpression, quantityLow } =
    applyColonAmount(source, leaves, lookups.knownUnitTokens, unspecificOpts) ??
    applyAmountUnit(source, leaves, lookups.knownUnitTokens, unspecificOpts);
```

- [ ] **Step 3:** Suppress the range text in notes for structured ranges — change the `noteContext`:
```ts
  // A structured low–high range renders as the amount, so it must NOT also
  // appear in the notes. Open-ended ranges (quantityLow null, e.g. "bis 3")
  // keep their note text.
  const noteContext: NoteContext = {
    rangeExpression: quantityLow != null ? null : rangeExpression,
    unitName,
    prepNote,
    leadNote,
  };
```

- [ ] **Step 4:** Add `quantityLow` to the returned object (next to `quantity`).

- [ ] **Step 5:** Run `npm run test -- amount-ranges-parse amount-ranges-numeric` → PASS. Then `npm run test -- recipe-import` → PASS (regression).

- [ ] **Step 6:** Commit (Tasks 3+4): `feat(parser): structured low–high ranges (low bound out of notes)`.

---

## Task 5: ImportedIngredient carries quantityLow

**Files:** Modify `src/lib/recipe-import/index.ts`.

- [ ] **Step 1:** Add to `ImportedIngredient` (after `quantity`):
```ts
  /** Low bound of a range, else null. High bound stays in `quantity`. */
  quantityLow: number | null;
```

- [ ] **Step 2:** At BOTH construction sites (`out.push({ quantity: astSeg.quantity, ...})` near lines 952 and 1609) add:
```ts
          quantityLow: astSeg.quantityLow,
```

- [ ] **Step 3:** `npm run test -- recipe-import` → PASS. `npm run typecheck` shows no NEW `src/` errors.
- [ ] **Step 4:** Commit: `feat(parser): expose range low bound on ImportedIngredient`.

---

## Task 6: Client types + draft builders

**Files:** Modify `src/components/recipes/types.ts`.

- [ ] **Step 1:** `ParsedIngredientResponse`: add `quantityLow: number | null;` after `quantity`.

- [ ] **Step 2:** `DraftIngredient`: add
```ts
  /** Low bound (German-formatted) when `isRange`; ignored otherwise. */
  quantityLow: string;
  /** Range mode toggle: when true the editor shows the low input and the row
   *  is invalid unless quantityLow < quantity. */
  isRange: boolean;
```

- [ ] **Step 3:** Import-draft builder (the `quantity: quantityToInputString(i.quantity)` object): add
```ts
    quantityLow: quantityToInputString(i.quantityLow ?? null),
    isRange: i.quantityLow != null,
```

- [ ] **Step 4:** `recipeToDraft` ingredient map (the `quantity: quantityToInputString(i.quantity)` object): add the same two lines, reading `i.quantityLow` (added to `RecipeView` in Task 8).

- [ ] **Step 5:** `emptyIngredient()` and any other inline `DraftIngredient` literals (e.g. the initial ingredient in `emptyRecipe`): add `quantityLow: "", isRange: false,`. Grep `quantity: ""` in `types.ts` to find them all.

- [ ] **Step 6:** `npm run typecheck` — fix any DraftIngredient literals flagged missing the new fields (there may be a manual-add row builder elsewhere; grep `quantity:` in `src/components/recipes`). Commit: `feat(recipes): draft carries quantityLow + isRange`.

---

## Task 7: Payload serialization + range validation helper

**Files:** Modify `src/components/recipes/payload.ts`. Test: `tests/amount-ranges-payload.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { ingredientToPayload, rangeError } from "@/components/recipes/payload";
import { emptyIngredient } from "@/components/recipes/types";

const base = () => ({ ...emptyIngredient(), name: "Zucker", quantity: "3" });

describe("range payload + validation", () => {
  it("serializes a valid range", () => {
    const p = ingredientToPayload({ ...base(), isRange: true, quantityLow: "2" });
    expect(p).toMatchObject({ quantity: 3, quantityLow: 2 });
  });
  it("null low when not a range", () => {
    expect(ingredientToPayload(base())).toMatchObject({ quantity: 3, quantityLow: null });
  });
  it("rangeError on low >= high", () => {
    expect(rangeError({ ...base(), isRange: true, quantityLow: "3" })).toBe(true);
    expect(rangeError({ ...base(), isRange: true, quantityLow: "5" })).toBe(true);
  });
  it("rangeError on empty low in range mode", () => {
    expect(rangeError({ ...base(), isRange: true, quantityLow: "" })).toBe(true);
  });
  it("no error for a valid range or a single amount", () => {
    expect(rangeError({ ...base(), isRange: true, quantityLow: "2" })).toBe(false);
    expect(rangeError(base())).toBe(false);
  });
});
```

- [ ] **Step 2:** Run `npm run test -- amount-ranges-payload` → FAIL.

- [ ] **Step 3: Implement** in `payload.ts`:

```ts
import type { DraftIngredient } from "./types";

/** True when the row is in range mode but the low bound is missing, non-numeric,
 *  or not strictly below the high bound. Used to block save + show inline error. */
export function rangeError(ing: DraftIngredient): boolean {
  if (!ing.isRange) return false;
  const low = toNumberOrNull(ing.quantityLow);
  const high = toNumberOrNull(ing.quantity);
  if (low === null || high === null) return true;
  return low >= high;
}
```

In `ingredientToPayload`, add to the returned object:
```ts
    quantityLow: ing.isRange ? toNumberOrNull(ing.quantityLow) : null,
```

- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit: `feat(recipes): serialize quantityLow + range validation helper`.

---

## Task 8: Recipe service persist + read model

**Files:** Modify `src/lib/recipes/service.ts`, `src/lib/recipes/types.ts`. Test: `tests/amount-ranges-roundtrip.test.ts`.

- [ ] **Step 1: Failing round-trip test** (temp migrated DB pattern, see existing `tests/unit-plural-matching.test.ts`):

```ts
// set up temp DB + migrate, then:
//  create a recipe with one ingredient quantity=3, quantityLow=2 via the
//  create service, read it back via the recipe view, assert quantityLow === 2.
```
(Write it concretely against the actual create/read service signatures — mirror an existing recipe-service test if present; otherwise assert at the DB row level that `quantity_low` persisted and the read model returns it.)

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement:**
  - **Insert** (the `recipeIngredient` `.values({...})` in the create/update service, ~line 326): add `quantityLow: ing.unassigned ? null : ing.quantityLow,`. Confirm the persist input type carries `quantityLow` (the payload type in `src/lib/recipes/types.ts` around line 24 — add `quantityLow: number | null`). Thread it from the API route's body validation (zod schema for the recipe payload — add `quantityLow: z.number().nullable().default(null)`).
  - **Read model:** add `quantityLow: number | null;` to the `IngredientRow` type (~line 452), `quantityLow: recipeIngredient.quantityLow,` to the `.select({...})` (~line 483), and `quantityLow: i.quantityLow,` to BOTH view object literals (~lines 548 and 629; the unassigned one can pass `i.ingredientId == null ? null : i.quantityLow`).
  - **RecipeView type** (`src/lib/recipes/types.ts` ~line 178): add `quantityLow: number | null;` to the read-view ingredient.

- [ ] **Step 4:** Run round-trip test → PASS. `npm run test -- recipe` → PASS.
- [ ] **Step 5:** Commit: `feat(recipes): persist + expose quantity_low through the recipe service`.

---

## Task 9: Range display

**Files:** Modify `src/components/recipes/ingredient-read-line.tsx`, `src/components/recipes/recipe-detail.tsx`. Test: `tests/amount-ranges-display.test.ts`.

- [ ] **Step 1: Failing test** for a shared formatter:

```ts
import { describe, expect, it } from "vitest";
import { formatAmount } from "@/components/recipes/ingredient-read-line";

describe("formatAmount range", () => {
  it("renders low–high for a range", () => {
    expect(formatAmount(3, 2)).toBe("2–3");
  });
  it("renders single value when no low", () => {
    expect(formatAmount(3, null)).toBe("3");
  });
  it("applies fraction formatting to both bounds", () => {
    expect(formatAmount(1, 0.5, { fraction: true })).toBe("1/2–1");
  });
  it("empty for null quantity", () => {
    expect(formatAmount(null, null)).toBe("");
  });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** in `ingredient-read-line.tsx`:

```ts
/** Format an amount or low–high range for display. Uses {@link formatQuantity}
 *  per bound, joined by an en-dash. Returns "" when there is no quantity. */
export function formatAmount(
  quantity: number | null,
  quantityLow: number | null,
  opts?: { fraction?: boolean },
): string {
  const high = formatQuantity(quantity, opts);
  if (quantityLow == null || quantity == null) return high;
  return `${formatQuantity(quantityLow, opts)}–${high}`;
}
```

- Add `quantityLow?: number | null;` to `ReadLineProps`, destructure it, and replace the `formatQuantity(quantity, { fraction: displayFraction })` call in the JSX with `formatAmount(quantity, quantityLow ?? null, { fraction: displayFraction })`.
- In `recipe-detail.tsx` line ~286 replace `formatQuantity(ing.quantity, { fraction: ing.displayFraction })` with `formatAmount(ing.quantity, ing.quantityLow, { fraction: ing.displayFraction })` (import `formatAmount`). Ensure the read-view ingredient passed here carries `quantityLow` (Task 8). The instruction-mention tip (`group.tips.push({ quantity: i.quantity, ... })`) may also show an amount — pass `quantityLow: i.quantityLow` and format with `formatAmount` wherever the tip renders its quantity.

- [ ] **Step 4:** Run display test → PASS. `npm run typecheck` clean in `src/`.
- [ ] **Step 5:** Commit: `feat(recipes): render low–high amount ranges in the read view`.

---

## Task 10: Editor toggle + low input + inline validation

**Files:** Modify `src/components/recipes/ingredient-row.tsx`.

- [ ] **Step 1:** Range mode state. Near the existing `amountDisabled`:
```ts
  const rangeOpen = value.isRange;
  const showRange = rangeOpen && !amountDisabled;
  const rowRangeError = rangeError(value); // import from ./payload
```
Add a toggle handler:
```ts
  function toggleRange() {
    onChange(
      value.isRange
        ? { ...value, isRange: false, quantityLow: "" }
        : { ...value, isRange: true },
    );
  }
```

- [ ] **Step 2:** In the RECIPE variant amount cell (the `<Input ... aria-label="Menge" disabled={amountDisabled} />` at ~line 757), wrap so the layout reads `[low]–[high] [toggle] [unit]`:

```tsx
            {showRange && (
              <Input
                inputMode="decimal"
                placeholder="von"
                value={value.quantityLow}
                onChange={(e) => onChange({ ...value, quantityLow: e.target.value })}
                aria-label="Menge von"
                aria-invalid={rowRangeError || undefined}
              />
            )}
            <Input
              inputMode="decimal"
              placeholder="Menge"
              value={value.quantity}
              onChange={(e) => onChange({ ...value, quantity: e.target.value })}
              aria-label="Menge"
              disabled={amountDisabled}
            />
            {!amountDisabled && (
              <button
                type="button"
                onClick={toggleRange}
                aria-pressed={value.isRange}
                aria-label={value.isRange ? "Einzelne Menge" : "Mengenbereich"}
                title={value.isRange ? "Einzelne Menge" : "Mengenbereich (von–bis)"}
                className="shrink-0 rounded p-1 text-[var(--color-muted-fg)] hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)]"
              >
                {/* lucide ArrowLeftRight or similar small glyph */}
                <ArrowLeftRight className="size-4" />
              </button>
            )}
```

Keep the toggle button BETWEEN the amount group and the unit `SelectSearch`
(per the brainstorm: "between the amount and unit input"). Match the existing
grid layout — adjust the column spans for the extra low input + button so the
unit dropdown still sits to their right. Inspect the surrounding grid classes
and extend them rather than guessing.

- [ ] **Step 3:** Inline error: under the amount group, render when `rowRangeError`:
```tsx
            {showRange && rowRangeError && (
              <p className="col-span-full text-xs text-[var(--color-danger)]">
                Untergrenze muss kleiner als die Obergrenze sein.
              </p>
            )}
```
(place it so it spans the row in the grid)

- [ ] **Step 4:** Import `ArrowLeftRight` from `lucide-react`, `rangeError` from `./payload`.

- [ ] **Step 5:** `npm run typecheck` clean; `npm run build` passes (client component / RSC guard).
- [ ] **Step 6:** Commit: `feat(recipes): range toggle + low-amount input in the ingredient editor`.

---

## Task 11: Block save on range error

**Files:** Modify `src/components/recipes/recipe-form.tsx`.

- [ ] **Step 1:** In `onSubmit`, after the title check and before `buildPayload`:
```ts
    const hasRangeError = draft.sections.some((s) =>
      s.ingredients.some((ing) => rangeError(ing)),
    );
    if (hasRangeError) {
      setError("Ein Mengenbereich ist ungültig: Untergrenze muss kleiner als die Obergrenze sein.");
      return;
    }
```
Import `rangeError` from `./payload`.

- [ ] **Step 2:** `npm run build` passes.
- [ ] **Step 3:** Commit: `feat(recipes): block save when a range is invalid`.

---

## Task 12: Shopping regression test

**Files:** Test `tests/amount-ranges-shopping.test.ts`.

- [ ] **Step 1:** Add a test asserting a recipe ingredient with `quantity=3, quantity_low=2` contributes `3` (the high bound) to the shopping list — exercise `buildShoppingFromSelection`/`merge` at whatever level existing shopping tests use, OR assert at the contribution level that only `quantity` is read. Mirror an existing shopping test's setup.

- [ ] **Step 2:** Run → PASS (no production change; locks behavior).
- [ ] **Step 3:** Commit: `test(shopping): ranged ingredient contributes only the high bound`.

---

## Task 13: Full verification

- [ ] `npm run test` → all green.
- [ ] `npm run typecheck` → no NEW `src/` errors (pre-existing test-fixture errors from earlier features may remain).
- [ ] `npm run build` → passes.
- [ ] Manual: in the editor, parse "2-3 EL Zucker" → row opens in range mode with 2 and 3; read view shows "2–3 EL"; toggling off clears the low; entering low ≥ high blocks save.

---

## Self-review notes

- **Spec coverage:** model (T1), parser low bound + note suppression (T2–T5), client/persist/read threading (T6, T8), display (T9), editor toggle + validation (T10–T11), shopping unchanged + locked (T12). All spec sections map to a task.
- **Type consistency:** `quantityLow` (number|null on wire/DB/read; string on draft), `isRange` (draft only), `rangeError`, `formatAmount` named consistently across tasks.
- **No scaling work:** confirmed the recipe read view does not scale by servings (recipe-detail.tsx renders stored amounts directly); shopping scaling uses the high `quantity` only.
- **Note suppression boundary:** only structured ranges (`quantityLow != null`) drop the range text from notes; open-ended "bis X" keeps it.
