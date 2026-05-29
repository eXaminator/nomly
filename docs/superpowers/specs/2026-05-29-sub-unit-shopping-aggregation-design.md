# Sub-unit shopping aggregation + canonical-name sub-unit default

**Date:** 2026-05-29
**Status:** Approved, implementing

## Problem

An ingredient can carry ingredient-local **sub-units** (`ingredient_sub_unit`, each
with `per_purchase` = how many of that sub-unit make one purchase unit) and a
**purchase unit** (`ingredient.purchase_unit_id`, e.g. *Packung*). A recipe line
can be expressed in a sub-unit (`recipe_ingredient.sub_unit_id`, `unit_id` NULL),
e.g. *"5 Stäbchen"* of Gemüsestäbchen (16 Stäbchen per Packung).

The shopping-list pipeline ignores sub-units entirely:

- `merge.ts` copies only `recipe_ingredient.unit_id` into
  `shopping_item_source.contributed_unit_id` — NULL for a sub-unit line, so the
  sub-unit identity is dropped.
- `items.ts` aggregates the unit-less contribution into the `"none"` dimension →
  the total renders as a bare *"5"* with no unit.
- `preview.ts` ("Mahlzeiten hinzufügen") joins `unit` only, so the preview line
  is also a bare *"5"*.

The schema comments already promise this rollup ("the shopping-list aggregator
rolls these up into the ingredient's purchase unit via `per_purchase`") — the
code was never written.

Secondary: a sub-unit default can be attached to ingredient **aliases**
(`ingredient_alias.default_sub_unit_id`) but **not** to the canonical ingredient
name, so a recipe line that matches by canonical name can't auto-pick the
sub-unit.

## Desired behaviour

- Source line shows what was entered: **"5 Stäbchen"**.
- The running list sums sub-unit contributions and converts to the purchase unit
  at the end, rounding **up** (you buy whole packs): 5 + 17 = 22 Stäbchen =
  22 ÷ 16 = 1.375 → **2 Packung**.
- An ingredient may have several sub-units that all roll up to the same purchase
  unit; each contribution converts to a *fraction* of a Packung
  (`qty ÷ per_purchase`), fractions sum, then ceil. The displayed total is the
  **purchase unit only** ("2 Packung") — no parenthetical sub-unit count, since
  there may be more than one sub-unit feeding it.
- If the ingredient has sub-units but **no** purchase unit: no rollup — sum each
  sub-unit on its own line, displayed with the sub-unit name ("22 Stäbchen").
- Contributions in other dimensions (mass/volume, or unrelated global count
  units) aggregate exactly as today, shown side-by-side.
- The canonical ingredient name gets its own default-unit / default-sub-unit, so
  it behaves like the aliases.

## Approach

Read-time rollup, preserving the sub-unit on each contribution (matches the
existing "sources are raw, amounts are derived at read time" architecture). A
shared `subunit-rollup.ts` holds the convert/sum/ceil math.

## Data model

- `shopping_item_source.contributed_sub_unit_id` — nullable FK →
  `ingredient_sub_unit` (`ON DELETE SET NULL`). For a sub-unit line:
  `contributed_unit_id` NULL, `contributed_sub_unit_id` set,
  `contributed_quantity` = scaled sub-unit count.
- `shopping_item_staple_source.contributed_sub_unit_id` — same, for staple adds
  (consistency; staples already carry `staple_group_item.sub_unit_id`).
- `ingredient.default_unit_id` + `ingredient.default_sub_unit_id` — nullable FKs,
  mirroring `ingredient_alias`. The canonical-name parser default.

Migration: `drizzle-kit generate` for the columns, then an appended backfill that
re-derives `contributed_sub_unit_id` for existing source rows from their
`recipe_ingredient.sub_unit_id` (and the staple mirror from
`staple_group_item.sub_unit_id`). Runs automatically on container start; no
manual steps.

## Write path

- `merge.ts loadRecipeIngredients` selects `sub_unit_id`; each contribution
  records `contributed_sub_unit_id` and leaves `contributed_unit_id` NULL when a
  sub-unit is used.
- `staples/groups.ts` staple→shopping conversion records
  `contributed_sub_unit_id` from `staple_group_item.sub_unit_id`.

## Read path & rollup (`items.ts` + `subunit-rollup.ts`)

Per shopping item, with the ingredient's `purchase_unit_id`/`purchase unit row`
and the referenced sub-units' `per_purchase` loaded:

1. Partition contributions (meal sources + staple sources + manuals):
   - **purchase track** = contributions carrying a sub-unit, plus contributions
     whose unit *is* the ingredient's purchase unit (so a hand-added "1 Packung"
     merges in). Only when the ingredient has a purchase unit.
   - everything else → existing per-dimension aggregation, unchanged.
2. Purchase-track amount: each contribution → purchase-unit fraction
   (sub-unit: `qty ÷ per_purchase`; purchase unit: `qty`). Sum, `Math.ceil`
   (epsilon-guarded so exact multiples don't bump). One amount: `{ quantity,
   unit = purchase unit, dimension = count }`. All-open-ended → quantity null,
   unit name shown.
3. No-purchase-unit fallback: group sub-unit contributions by sub-unit id, sum
   each, emit one amount per sub-unit with `unitName = sub-unit name`,
   `dimension = "none"` (so it renders "22 Stäbchen").

`ShoppingItemSourceView` gains `contributedSubUnitId` + `contributedSubUnitName`;
the source line renders the sub-unit name when present.

## Preview dialog

`preview.ts` left-joins `ingredient_sub_unit` on `recipe_ingredient.sub_unit_id`
and exposes the sub-unit name so a line shows "5 Stäbchen". Per-meal lines stay
in the sub-unit; rollup-to-Packung only happens on the aggregated running list.

## Stammdaten editor

The canonical name gets the same default-unit / default-sub-unit picker the
aliases already have, persisting to the new `ingredient` columns
(`default_sub_unit_id` resolved via the same `subUnitIndex` mechanism aliases
use). Parser resolution order when a line has no explicit unit: alias default →
**ingredient default** → generic `Stück`.

## Editing semantics

The rolled-up purchase total is **derived/read-only**. The user adjusts the
underlying per-source sub-unit quantities (the editor already supports per-source
edits via `setSourceQuantity`); the total recomputes. Manual additions can be
entered in the purchase unit or any global unit. Manual entry *in a sub-unit* is
out of scope for this pass.

## Testing

- `subunit-rollup.ts` units: single sub-unit; multiple sub-units → same Packung;
  mixed sub-unit + direct Packung; exact multiple (no rounding bump);
  no-purchase-unit fallback; cross-dimension side-by-side.
- Integration: two meals (5 + 17 Stäbchen) → list shows "2 Packung" with two
  correct "N Stäbchen" source lines; preview shows "5 Stäbchen".
- Parser: canonical-name match with no explicit unit picks the ingredient
  default sub-unit.
- `npm run build` before pushing (RSC boundary safety).
