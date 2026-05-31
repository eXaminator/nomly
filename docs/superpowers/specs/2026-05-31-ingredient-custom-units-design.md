# Ingredient custom units with explicit parent + per-ingredient density

**Date:** 2026-05-31
**Status:** Approved, implementing on branch `feat/ingredient-custom-units`

## Problem

Spices like cinnamon arrive in incompatible shapes: sometimes "2 TL"
(volume), sometimes "2 Stangen" (a count sub-unit). Two gaps today:

1. A sub-unit always rolls up into the ingredient's single `purchaseUnit`
   (e.g. "Stange" → "Stück"). There's no way to say "keep this sub-unit as its
   own thing" so "2 Stangen" stays "2 Stangen" instead of becoming "2 Stück".
2. Volume (TL/EL/ml) isn't useful for shopping non-liquids; the user wants it
   shown in grams, but the conversion is ingredient-specific.

## Decisions (from brainstorming)

- **Reframe:** drop the single ingredient-level purchase unit. Each *custom
  unit* (today's sub-unit) declares its own conversion: **"1 ⟨custom unit⟩ =
  `parentAmount` × ⟨parent unit⟩"**, where the parent is any global unit, or
  **no parent = standalone** (its own shopping line, never converted).
- **Density:** a per-ingredient `gramsPerMl` converts global volume units to
  grams on the shopping list, with a UI link to a food-density reference.
- **Rounding:** round up to whole units only when the parent/aggregate is a
  count/container dimension. Mass/volume sum exactly.
- One combined plan; implemented in ordered phases.

## Data model (migration `0027`)

- `ingredient_sub_unit`: **drop** `per_purchase`; **add** `parent_unit_id`
  (nullable FK → `unit`, `onDelete: set null`) + `parent_amount`
  (real, NOT NULL, default 1). Semantics: `1 custom = parent_amount × parent`.
  `parent_unit_id` NULL ⇒ standalone.
- `ingredient`: **drop** `purchase_unit_id`; **add** `grams_per_ml`
  (nullable real).
- **Backfill** (behavior-preserving), before dropping the old columns:
  - `parent_unit_id = ingredient.purchase_unit_id` (joined via ingredient_id)
  - `parent_amount = 1.0 / per_purchase` when `purchase_unit_id` is set and
    `per_purchase > 0`; else leave `parent_unit_id` NULL (standalone), as a
    sub-unit with no purchase unit already fell back to a standalone total.
- SQLite ≥ 3.35 (better-sqlite3) supports `DROP COLUMN`, so the migration is
  hand-authored: `ADD COLUMN`s → `UPDATE` backfill → `DROP COLUMN`s, in order.
  Final schema must match `schema.ts` so future `db:generate` is a no-op.

## Conversion semantics

`parent_amount` = parent units per **one** custom unit (`1 Stange = 4 g` →
4; `1 Zehe = 0.1 Stück` → 0.1). Shopping converts `customQty × parent_amount`.
Migration from the old "N per purchase unit" (`per_purchase = 10` Zehen per
Stück) gives `parent_amount = 1/10 = 0.1`, which is exact and preserves the
old rollup math.

## Shopping aggregation (core rewrite: `subunit-rollup.ts` + `items.ts`)

Per shopping item, each contribution `{ quantity, unit | customUnit }`:

1. **Custom unit, no parent** → standalone bucket keyed by custom-unit id,
   summed exactly → its own amount line ("2 Stangen", pluralised).
2. **Custom unit with parent** → convert to the parent global unit
   (`quantity × parent_amount`); continue as a global contribution.
3. **Global volume unit + ingredient `gramsPerMl` set** → convert to grams
   (`quantity × unit.factor(→ml) × gramsPerMl`), now a mass contribution.
4. Aggregate per dimension in base units (existing logic):
   - **count / container** → round **up** to whole (the "buy whole packs"
     behaviour, now keyed on dimension rather than the purchase track).
   - **mass / volume** → exact; display unit auto-picked by factor (g↔kg,
     ml↔l).

A single item can therefore show several lines, e.g. **"5 g + 2 Stangen"**.
Recipe read/edit views are unchanged — they still show "2 TL" / "2 Stangen".

The old `rollupPurchaseTrack` / purchase-track routing is replaced by:
convert-to-parent → per-dimension sum (with count/container ceiling) +
standalone per-custom-unit totals.

## UI

- **Ingredient form (`ingredient-form.tsx`):**
  - Remove the "Einkaufseinheit" purchase-unit picker.
  - Custom-unit (Teil-Einheit) editor: replace the `perPurchase` number with a
    **parent picker + amount**, phrased as `1 ⟨name⟩ = [amount] [parent ▾]`,
    with an **"eigenständig" (kein Parent)** choice. For count/container
    parents the field flips to the natural "Wie viele ⟨name⟩ ergeben 1
    ⟨parent⟩?" and stores the reciprocal.
  - Add a **Dichte (g/ml)** field with a "Dichte nachschlagen ↗" link to a
    food-density reference table.
- **Sub-unit master-data page:** "pro Einkauf" column → "Umrechnung"
  (`1 Zehe = 0,1 Stück` / `eigenständig`); edit drawer gets parent + amount +
  standalone.

## Other touch points

- `recipe-import/index.ts`: `SubUnitRef` carries `perPurchase` → carries
  `parent` (unit id + amount) / standalone; `buildSubUnitLookup` selects the
  new columns. `matching.ts` / `reparse-scan.ts` only pass `SubUnitRef`
  through — update the type usage (note: these files were just committed with
  unrelated fuzzy-matching work).
- familywall seed catalog (`seed-catalog.ts`, `ingredient-catalog-data.ts`,
  `ingredient-catalog.ts`): per-ingredient `perPurchase` + `purchaseUnit` data
  → `parent` + `amount`; add known densities where sensible.
- recipe components/types (`ingredient-row.tsx`, `recipes/types.ts`): drop the
  `perPurchase`-based sub-unit conversion display, or re-derive from parent.
- ingredient APIs (`manage` + `[id]`, `sub-units/manage/[id]`), `seed.ts`,
  `stammdaten/ingredient/service.ts`, `stammdaten/sub-unit/service.ts`.

## Testing

- Aggregation: standalone stays its own line; parent-count converts + ceils;
  parent-mass merges; density converts volume→g; multiple lines coexist.
- Migration backfill: existing `perPurchase`/`purchaseUnit` → `parent`,
  standalone when no purchase unit; round-trip preserves old shopping totals.
- Service + form payload round-trips (parent set / standalone / density).
- `npm run test`, `npm run typecheck`, `npm run build` before merge.

## Phasing

1. Schema + migration + aggregation core + tests (behaviour-preserving).
2. UI (ingredient form custom-unit editor + density; sub-unit page column).
3. Seed/familywall data + import type cleanup.

## Risks

- Broad refactor (purchase-unit/perPurchase reach recipe-import, seed catalog,
  recipe components). Phasing keeps each step reviewable and green.
- The density helper link must point at a stable external resource; pick one
  during implementation and keep it a plain link (no scraping).
