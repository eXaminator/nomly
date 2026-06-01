# Bulk conversions for the article list

## Problem

When managing articles (ingredients) in the Stammdaten list, you can already
multi-select rows and bulk-edit category / dietary class / shopping-list
exclusion. But unit conversions (*Umrechnungen*) are invisible in the list and
can only be edited one article at a time in the edit drawer.

Two gaps:

1. **Visibility** — you can't tell from the list which articles carry
   conversions, or how many.
2. **Bulk editing** — a common task ("define `ml → 1l-Flasche` on all oils")
   means opening each oil's drawer and re-entering the same conversion.

## Goal

- Surface each article's conversions inline in the list.
- Let the user add one conversion to all selected articles in a single action,
  with collision detection (some articles may already have that `from → to`
  edge with a different factor) and per-conflict resolution.

## Decisions (settled in brainstorming)

- **List display:** inline text summary in a new column — each edge as
  `from→to`, comma-joined (e.g. `ml→g, Pck→Stk`). Plain, no container marker.
- **Collision rule:** detect conflicts up front, then let the user choose
  **skip or overwrite per conflicting article**. Default = skip (safe).
- **Where it lives:** a dedicated "Umrechnung hinzufügen" action in the sticky
  selection bar, opening a new `BulkConversionDialog` — *not* folded into the
  existing tri-state `BulkIngredientDialog`, whose instant-apply patch model
  doesn't fit the multi-step conflict-review flow.

## Conversion semantics (existing)

`ingredient_unit_conversion`: `1 from_unit = factor × to_unit`. Unique on
`(ingredient_id, from_unit_id, to_unit_id)`. `is_container` marks the
"buy whole packs" rounding rule. A conflict is an existing row with the same
`(ingredient_id, from_unit_id, to_unit_id)` triple.

## Design

### 1. List display — inline summary column

`IngredientItem.conversions[]` is already loaded by `listIngredients`, so no
data-layer change. Add a `conversions` column to the ingredient list
(`ingredient-page-client.tsx` `columns`) rendering each edge as
`fromUnitName→toUnitName`, joined by `, `. Empty → muted `—`. `sortValue` =
`conversions.length` so the column sorts by count.

### 2. Selection-bar action

`ListShell`'s `renderBulkActions` slot gains `selectedItems: TItem[]` alongside
the existing `selectedIds` (the shell already computes `selectedItems`; this is
a backward-compatible addition — `BulkIngredientDialog` ignores it).
`IngredientPageClient` renders a second button, **"Umrechnung hinzufügen"**,
next to the existing "Bearbeiten", opening the new dialog with the selected
items (it needs each item's `conversions` for client-side conflict detection).

### 3. `BulkConversionDialog` (new component)

Two steps in one dialog:

- **Step 1 — Define:** mirrors the single-article conversion row from
  `ingredient-form.tsx`: `from` (SelectSearch unit picker), `factor`
  (`NumberInput`, decimal), `to` (SelectSearch), and a **Gebinde** (isContainer)
  checkbox. "Weiter" enabled when `from`, `to` both chosen, `from ≠ to`,
  `factor > 0`.
- **Step 2 — Review & resolve:** computed entirely client-side from the
  in-memory `conversions[]`. Articles split into:
  - **Neu** — no existing edge for this `(from→to)` → will be added. Shown as a
    count.
  - **Konflikte** — already have the edge. Each listed with its *current*
    `factor`/container vs. the *new* value and a per-row **Überschreiben /
    Überspringen** toggle (default Überspringen).
  - "Zurück" returns to step 1. "Auf N anwenden" applies, where
    N = (new count) + (conflicts toggled to overwrite).

On success: `onApplied()` (clears selection + `router.refresh()`) then close.

### 4. Server

**Route:** `POST /api/v1/ingredients/bulk-conversions`

```
{ fromUnitId, toUnitId, factor, isContainer,
  addIds: number[],        // no existing edge → insert
  overwriteIds: number[] } // existing edge → update factor + isContainer
```

Zod: positive ints, `factor > 0`, `fromUnitId ≠ toUnitId`,
`addIds.length + overwriteIds.length ≥ 1`. Calls `bulkAddConversion`, then
`publishShoppingChanged()` (conversions feed the shopping aggregator — same as
the single-edit route), returns the result counts.

**Service:** `bulkAddConversion(input): BulkConversionResult` in
`ingredient/service.ts`. Unlike `writeConversions` (replace-all), this is
**additive** — it never touches an article's other conversions. Logic:

- Validate `from ≠ to`, `factor` finite & `> 0`, and that both units exist
  (nice 404 instead of a raw FK 500).
- Query which of `addIds ∪ overwriteIds` already have the `(from→to)` edge.
- In one transaction, per id:
  - no existing edge → **insert** → `addedIds`
  - existing edge & in `overwriteIds` → **update** `factor`+`isContainer` →
    `overwrittenIds`
  - existing edge & only in `addIds` (raced/stale) → **skip** → `skippedIds`
- Returns `{ addedIds, overwrittenIds, skippedIds }`.

This re-checks existence server-side rather than trusting the client's
classification, so a conversion added between load and apply is never silently
clobbered.

### 5. Tests

Service-level vitest (`tests/stammdaten-ingredient.test.ts`):

- pure add to articles with no prior edge
- skip when edge exists and id only in `addIds`
- overwrite when edge exists and id in `overwriteIds` (factor + container flip)
- unrelated existing conversions on a touched article survive
- rejects `from === to` and non-positive factor
- rejects unknown unit id

## Out of scope

- Bulk *removing* conversions.
- Adding more than one conversion edge per dialog run (re-run for the next).
- Container marker in the list summary.
