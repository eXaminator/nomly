# Full ingredient options on create

**Date:** 2026-06-09
**Status:** Approved (brainstorming) — ready for implementation plan

## Problem

When a new ingredient ("article" / catalog entry) is created from a creation
flow, the dialog only exposes a minimal field set: category, dietary class,
equipment flag, and exclude-from-shopping. The richer catalog options that the
full Stammdaten editor (`IngredientForm`) offers — **default unit**,
**excluded supermarkets**, **conversions**, and **aliases** — are unavailable
at creation time and must be added afterwards via the settings page.

The two real creation flows are:

- **`CreateArticleDialog`** (`src/components/ingredients/create-article-dialog.tsx`):
  single ingredient, created immediately via its own `POST /api/v1/ingredients/manage`.
- **`NewIngredientsDialog`** (`src/components/recipes/new-ingredients-dialog.tsx`):
  one card per new name, **batch + deferred** — it hands a `NewIngredientDefaults[]`
  back to the caller, which persists the ingredients. This single dialog backs
  three surfaces:
  - recipe save (`RecipeForm` → `POST /api/v1/recipes` / `PATCH /api/v1/recipes/{id}`),
  - bulk re-parse (`BulkReparseDialog` → `POST /api/v1/recipes/reparse-apply`),
  - the mass paste/parser path (feeds new names into `NewIngredientsDialog`),
  - staples (`StapleGroupDetailClient`, which already maps each default to a
    full `manage` payload and calls `POST /api/v1/ingredients/manage` directly).

The "mass edit" dialog in Stammdaten (`BulkIngredientDialog`) edits *existing*
ingredients in bulk and creates nothing — it is out of scope.

## Goal

Make all four richer options available in both create flows, presented behind a
collapsed "Erweitert" (advanced) section so the common case stays simple.

## Design

### 1. Shared field-editor components

Today the four editors live as inline JSX inside `IngredientForm`
(`src/components/settings/stammdaten/edit-forms/ingredient-form.tsx`), split
across its tabs (Stammdaten / Umrechnungen / Aliase). Extract each into a
reusable component under `src/components/ingredients/article-fields/`:

- `DefaultUnitField` — unit `SelectSearch` plus the display-override input
  (`defaultUnitId` + `defaultUnitDisplay`).
- `ExcludedSupermarketsField` — the pill add/remove list.
- `ConversionsEditor` — the rows editor (from-unit, to-unit, factor,
  `isContainer`), with add/update/remove.
- `AliasesEditor` — alias rows with per-alias default unit and display name,
  plus the advisory cross-ingredient collision lookup. Edit-only concerns are
  gated behind props and default off in the create context:
  - `enableRenamePropagation` (propagate alias renames to recipes),
  - `enableSwapWithName` (swap an alias with the canonical name).

`IngredientForm` is refactored to render these extracted components inside its
existing tabs. **No UX change to the full edit form** — its tabbed layout and
all behavior (including rename propagation and swap-with-name) are preserved.

A thin `AdvancedArticleFields` wrapper composes all four editors inside a single
collapsible ("Erweitert", collapsed by default). This wrapper is used **only by
the create dialogs** — the full edit form keeps its tabbed split.

The aliases editor keeps its advisory collision UI in the create context: the
new ingredient doesn't exist yet, but an entered alias can still collide with
another ingredient's name/alias, and the existing lookup surfaces that as a
non-blocking note (consistent with how the catalog already treats overlaps).

### 2. The two create dialogs

- **`CreateArticleDialog`**: render `AdvancedArticleFields` below the existing
  basic fields. It already POSTs the full `manage` payload, so only the new
  client state needs wiring into the request body.
- **`NewIngredientsDialog`**: give each per-name card its own collapsed
  `AdvancedArticleFields`. Widen the per-row state to hold the four field
  groups and include them in the `NewIngredientDefaults` returned by `onConfirm`.

### 3. Data shape

Widen `NewIngredientDefaults` (`src/lib/recipes/types.ts`) with optional rich
fields mirroring the `manage` schema, each defaulting to empty so existing call
sites and tests remain valid:

- `aliases: string[]`
- `aliasUnitDefaults: Array<{ aliasName: string; unitId: number | null; unitDisplay: string | null }>`
- `aliasDisplayNames: Record<string, string>`
- `conversions: Array<{ fromUnitId: number; toUnitId: number; factor: number; isContainer: boolean }>`
- `defaultUnitId: number | null`
- `defaultUnitDisplay: string | null`
- `excludedSupermarketIds: number[]`

Extract the shared zod sub-schemas (`aliasDefaultSchema`, `conversionSchema`,
and the rich-defaults object) into a shared module so the `manage` route, the
recipe `validate.ts` schema, and the reparse-apply schema all validate against
one definition — no drift between the creation paths.

### 4. Server: one creation core

In `src/lib/stammdaten/ingredient/service.ts`, extract `createIngredientCore(tx, input)`
from the current `createIngredient` transaction body (insert + `writeConversions`
+ `writeExcludedSupermarkets` + alias inserts — the helpers are already `tx`-aware).

- `createIngredient` becomes `db.transaction((tx) => createIngredientCore(tx, input))`.
- Recipe-save's `resolveIngredient` (`src/lib/recipes/service.ts`) calls
  `createIngredientCore` on its insert branch, passing the rich defaults from a
  widened `buildNewIngredientDefaultsMap`, instead of the current bare 4-column
  insert.
- Name-collision validation (`validateInput` → `findNameCollision`) is made
  `tx`-aware, or skipped on the recipe path where `resolveIngredient` has
  already proven non-existence via its canonical/alias lookups. Alias de-dupe
  still runs in the core.

Result: recipe save and bulk-reparse persist the rich ingredient **atomically,
in the same transaction as the recipe** — no orphan catalog rows if the save
fails. The staples flow already builds a full `manage` payload, so it just
forwards the new fields collected by the dialog.

### 5. Testing & verification

- **Unit:** `createIngredientCore` parity — a rich create via `manage` and via
  the recipe-save path produce identical catalog rows (ingredient + conversions
  + excluded supermarkets + aliases with per-alias unit/display).
- **Integration:** recipe save with one new ingredient carrying a conversion,
  an alias, a default unit, and an excluded supermarket persists all of it.
- **Regression:** `IngredientForm` edit behavior (incl. rename propagation,
  swap-with-name, collision notes) unchanged after the editor extraction.
- `npm run build` before pushing — catches RSC client/server boundary errors
  that tsc/vitest miss (project convention).

## Out of scope

- `BulkIngredientDialog` (mass edit of existing ingredients) — unchanged.
- Any change to the matching/parsing logic.
- New catalog fields beyond the four the full edit form already supports.
