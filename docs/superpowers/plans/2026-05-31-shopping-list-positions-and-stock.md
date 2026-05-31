# Shopping List Positions & Stock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. TDD where logic is non-trivial; `npm run build` before push.

**Goal:** Make every shopping-list total fully explainable by visible positions (meal notes, standard lists, alternatives), give manual entries a real unit, add a subtracting "Auf Lager" stock position with a whole-list editor, and make Stammdaten edits propagate live to the list.

**Architecture:** Read-side aggregation in `src/lib/shopping/items.ts` + pure engine `src/lib/units/convert.ts`. New `shopping_item_stock` table feeds the engine as a clamped subtraction. Category becomes read-derived from `ingredient.default_category_id`. Stammdaten mutation routes call `publishShoppingChanged()` for live WS push; offline cache is unchanged.

**Tech Stack:** Next.js 16, SQLite + Drizzle, React client components, vitest, playwright, idb.

Spec: `docs/superpowers/specs/2026-05-31-shopping-list-positions-and-stock-design.md`

---

## Phase 1 — Transparent positions (display-only)

### Task 1: Meal notes on source positions (#1)
**Files:** Modify `src/lib/shopping/items.ts` (source query + `ShoppingItemSourceView`), `src/components/shopping/shopping-item-row.tsx`, `src/components/shopping/edit-item-dialog.tsx`. Test: `tests/shopping.test.ts`.
- [ ] Add `mealNote: string | null` to `ShoppingItemSourceView`.
- [ ] Add `mealNote: mealPlan.note` to the source `select` (items.ts ~150) and map it through (~176, ~341).
- [ ] Test: an item sourced from a meal with `note` exposes `source.mealNote`.
- [ ] Render `mealNote` on each meal position in row + edit dialog (next to recipe date/title; distinct from per-recipe `recipeNotes`).
- [ ] `npm run test -- shopping` green; commit.

### Task 2: Standard-list positions visible (#7)
**Files:** Modify `src/components/shopping/shopping-item-row.tsx`, `src/components/shopping/edit-item-dialog.tsx`.
- [ ] Confirm whether `stapleSources` already render. If not, render each as a labelled position "Standardliste: {stapleGroupName}" with its `contributedQuantity`/`contributedUnit`, mirroring meal positions, in both the row breakdown and edit dialog.
- [ ] Commit.

### Task 3: Alternative ident icon in add-meals (#3)
**Files:** Modify `src/components/shopping/add-meals-dialog.tsx` (`IngredientCheckbox` ~509-571).
- [ ] Import `CornerDownRight` from `lucide-react`.
- [ ] When `ing.alternativeForId != null`: render `CornerDownRight` (size-4, muted) + left indent; suppress the "optional" pill for these rows. Keep the pill for non-alternative optionals only.
- [ ] Commit.

---

## Phase 2 — Manual entry units (#2)

### Task 4: Default-unit resolver helper
**Files:** Create `src/lib/shopping/default-unit.ts`. Test: `tests/shopping-default-unit.test.ts`.
- [ ] `resolveDefaultUnitForIngredient(ingredientId): { unitId: number | null; display: string | null }` — alias is not known here, so use ingredient `default_unit_id`/`default_unit_display`; fallback to the "Stück" unit id (look up by name) else null.
- [ ] Tests: ingredient with default unit; ingredient without → "Stück"; missing ingredient → null.
- [ ] Commit.

### Task 5: Unit picker in add-item dialog
**Files:** Modify `src/components/shopping/add-item-dialog.tsx`, `src/components/shopping/api.ts` (ensure `addItem` forwards `unitId`), new endpoint or reuse for default-unit lookup.
- [ ] Add an alias-aware unit picker (reuse `src/components/units/unit-picker.ts` + existing unit-select component used elsewhere). State: `unitId`, default seeded when an article is picked via the resolver (server route `GET /api/v1/ingredients/[id]/default-unit` or fold into autocomplete hit payload).
- [ ] On pick/resolve: default unit to article's default (or "Stück"); user can change.
- [ ] `addItem({ ingredientId, quantity, unitId })`.
- [ ] Commit.

### Task 6: Unit picker for manual amounts in edit dialog
**Files:** Modify `src/components/shopping/edit-item-dialog.tsx`.
- [ ] The "Weitere Menge"/manual amount rows get the same unit picker, defaulting as above.
- [ ] Commit.

---

## Phase 3 — "Auf Lager" stock (#5 + #6)

### Task 7: Schema + migration for `shopping_item_stock`
**Files:** Modify `src/db/schema.ts`; generate migration in `drizzle/`.
- [ ] Add `shoppingItemStock` table (see spec). Unique on `item_id`.
- [ ] `npx drizzle-kit generate`; verify a `0033_*.sql` is produced; commit schema + migration.

### Task 8: Engine subtraction (TDD)
**Files:** Modify `src/lib/units/convert.ts`. Test: `tests/units-convert.test.ts` (or existing convert test file).
- [ ] **Write failing tests** for `aggregateContributions(contributions, subtractions, edges, units)`:
  - stock subtracts within same dimension, clamps at 0;
  - subtraction happens before container `ceil` (remainder packs);
  - cross-dimension stock is inert (no phantom line);
  - stock-only component emits no line.
- [ ] Run → fail (arity/behavior).
- [ ] Implement: add `subtractions` param; per component compute `posBase` and `subBase`; `baseTotal = max(0, posBase - subBase)`; gate emission on positive contribution presence.
- [ ] Update all existing callers to pass `[]` subtractions (or default param). Run tests → pass; commit.

### Task 9: Wire stock into the read view
**Files:** Modify `src/lib/shopping/items.ts`. Test: `tests/shopping.test.ts`.
- [ ] Load stock rows per item; add `stock` to `ShoppingItemView`.
- [ ] Pass stock as the `subtractions` arg to `buildAggregatedAmounts` → `aggregateContributions`.
- [ ] Tests: total drops by stock; fully-covered → 0; cross-dimension inert. Commit.

### Task 10: Stock mutation endpoints
**Files:** Create `src/app/api/v1/shopping/items/[id]/stock/route.ts` (PUT upsert, DELETE clear); create `src/app/api/v1/shopping/stock/route.ts` (POST batch). Service fns in `items.ts`: `setItemStock(itemId, {quantity, unitId})`, `clearItemStock(itemId)`, `setStockBatch([{itemId, quantity, unitId}])`.
- [ ] Implement upsert keyed on unique `item_id`; compute dimension from unit; `publishShoppingChanged()` after each.
- [ ] Tests for service fns. Commit.

### Task 11: "Auf Lager" line in edit dialog (#5)
**Files:** Modify `src/components/shopping/edit-item-dialog.tsx`, `src/components/shopping/api.ts`, `src/components/shopping/shopping-item-row.tsx`.
- [ ] Fixed "Auf Lager" row: amount input + unit picker (default = ingredient default unit, changeable). Save → PUT stock; empty → DELETE.
- [ ] Render stock as a distinct subtracting position ("Auf Lager: −X Einheit") in the breakdown; chip on collapsed row when set.
- [ ] Commit.

### Task 12: Whole-list stock dialog (#6)
**Files:** Create `src/components/shopping/stock-check-dialog.tsx`; wire a toolbar button in `src/components/shopping/shopping-list-view.tsx`.
- [ ] Dialog lists every item: name + amount input + unit (default = current stock unit or ingredient default). Batch-save via POST `/api/v1/shopping/stock`.
- [ ] Commit.

---

## Phase 4 — Dynamic-but-cached article data (#4)

### Task 13: Read-derived category
**Files:** Modify `src/lib/shopping/items.ts`. Test: `tests/shopping.test.ts`.
- [ ] In `listShoppingItems`, derive `categoryId`/`categoryName` by joining `category` via `ingredient.default_category_id` instead of `shopping_item.category_id`.
- [ ] Test: changing `ingredient.default_category_id` changes the listed category without touching the item. Commit.

### Task 14: Realtime push on Stammdaten edits
**Files:** Modify mutation routes: `src/app/api/v1/ingredients/manage/[id]/route.ts`, `ingredients/manage/route.ts`, `ingredients/merge/route.ts`, `units/manage/[id]/route.ts`, `units/manage/route.ts`, `units/merge/route.ts`, `categories/manage/[id]/route.ts`, `categories/merge/route.ts`, `supermarkets/manage/[id]/route.ts`, `supermarkets/bulk/route.ts`.
- [ ] Call `publishShoppingChanged()` after successful mutations that affect shopping display (category, default unit, conversion edges, unit factor/container/plural, category rename, supermarket-category mapping).
- [ ] Manual verify (or test) that a category change triggers a "shopping" WS broadcast. Commit.

---

## Final verification
- [ ] `npm run lint` / `npm run test` green.
- [ ] `npm run build` green (RSC boundaries).
- [ ] E2E: stock set drops total; whole-list stock round-trip; Stammdaten category change pushes to open list.
- [ ] Push branch.

## Self-review notes
- Every spec requirement (#1–#7) maps to a task: #1→T1, #2→T4-6, #3→T3, #4→T13-14, #5→T11, #6→T12, #7→T2. Engine/data prerequisites: T7-10.
- Signatures consistent: `aggregateContributions(contributions, subtractions, edges, units)` used in T8 & T9; `setItemStock`/`clearItemStock`/`setStockBatch` in T10/T11/T12.
