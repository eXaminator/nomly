# Bulk Re-Parse All Recipes — Design

**Status:** approved-pending-review
**Date:** 2026-05-30
**Author:** brainstorming session

## Purpose

Re-apply the current ingredient parser to **every** recipe's original ingredient
lines, in a controlled, review-first way. Use cases: pick up parser improvements
across the whole library after the parser changes, and revert ad-hoc manual
edits back to the parsed result. Nothing is written until the user reviews a diff
and explicitly applies a selection.

This is the library-wide companion to the existing per-row / per-recipe re-parse
buttons (`src/components/recipes/reparse.ts`, `POST /api/v1/ingredients/reparse`).

## Scope

- **In:** a Settings entry that scans all recipes, a review modal grouped by
  recipe showing only *changed* line-groups (current vs. proposed, editable),
  opt-in checkboxes per ingredient-line and per recipe, the existing
  new-ingredient dialog for unmatched names, and a bulk apply that reuses the
  normal recipe-update path.
- **Out (v1):** undo/rollback of an applied batch (rely on per-row re-parse to
  re-derive, or manual edit); virtualized rendering (only if the changed set is
  actually janky); scheduling/automation; diffing rows that have no `rawLine`.

## Core concepts

- **Source line is the diff unit.** A recipe ingredient stores the original
  source line it was parsed from in `recipe_ingredient.rawLine`. Within a
  section, contiguous rows sharing the same `rawLine` form one **line-group**
  (alternatives expanded from one line share that line). Re-parsing a line can
  change the *number* of rows, so we diff and apply at the line-group level, not
  the individual-row level. Rows with no `rawLine` (manually added, or pre-dating
  `rawLine`) are skipped entirely.
- **A line-group is "changed"** when the freshly parsed rows differ from the
  current rows in their normalized sequence (see Change detection).
- **Proposed rows are editable** before applying, using the same matching UI the
  recipe form uses.

## Components & data flow

### 1. Entry point
A button in `src/app/(app)/einstellungen/page.tsx` (a "Wartung"/maintenance area):
**"Alle Rezepte neu parsen"**. Clicking opens the review modal, which immediately
runs the scan.

### 2. Scan endpoint — `POST /api/v1/recipes/reparse-scan`
Read-only. Server-side:
1. Build lookups once (`buildUnitLookup` / `buildIngredientLookup` /
   `buildIngredientCatalog` / `buildSubUnitLookup`).
2. For each recipe (via a service that reads all recipes with their sections +
   ingredients incl. `rawLine`, ids, and full current fields):
   - Walk each section's rows; form contiguous line-groups by `rawLine`
     (skip rows with empty `rawLine`).
   - Re-parse the line with `parseIngredientLines([rawLine], lookups)`.
   - Compare proposed rows to current rows (Change detection). Keep only changed
     groups.
3. Return changed groups grouped by recipe.

Response shape:
```ts
type ReparseScanEntry = {
  recipeId: number;
  title: string;
  sectionId: number;
  rawLine: string;
  currentRowIds: number[];          // recipe_ingredient ids in the group (apply target)
  current: ScanRowSummary[];        // read-only display of current rows
  proposed: ParsedIngredientResponse[]; // seed for the editable draft + display
};
type ScanRowSummary = {
  name: string;
  canonicalName: string | null;     // mapping
  quantity: number | null;
  unitLabel: string | null;         // unit or sub-unit display
  notes: string | null;
  isOptional: boolean;
  isAlternative: boolean;
};
// → { entries: ReparseScanEntry[] }  (already only-changed)
```
`ParsedIngredientResponse` is the same type `parsedIngredientToDraft` consumes, so
the client seeds editable `DraftIngredient`s with zero translation.

### 3. Change detection (shared, unit-tested)
A pure helper `isLineGroupChanged(current: ScanRowSummary[], proposed: ParsedIngredientResponse[]): boolean`,
plus the normalization it uses. A group is changed if the two sequences differ on
any of, per row, in order:
- ingredient mapping (resolved ingredient id; new/unmapped vs mapped also counts),
- display name (trimmed, case-sensitive as stored),
- notes (trimmed; `null`/`""` equivalent),
- quantity (numeric equality with small epsilon),
- unit / sub-unit (by id; unit vs sub-unit mismatch counts),
- optional flag,
- alternative flag,
- **row count**.

This is the most-tested unit: it decides what the user sees, and a wrong
comparison either floods the list with no-op entries or hides real changes.

### 4. Review modal (`src/components/recipes/bulk-reparse-dialog.tsx`)
- On open: `POST /reparse-scan`; show a spinner with progress copy
  ("Prüfe Rezepte…"). On empty result: "Keine Änderungen gefunden."
- Layout, grouped by recipe:
  - Recipe header: title + a **recipe-level checkbox** (toggles all its entries;
    indeterminate when partial). A global **"Alle auswählen / abwählen"** control.
  - Each changed entry:
    - `Original: „<rawLine>"`.
    - **Current** (read-only, compact): per row `name · = canonical · Menge Einheit · Notiz`,
      with optional/alternative markers — styled like the recipe rows.
    - **Proposed** (compact by default) + a **"Bearbeiten"** toggle that lazily
      mounts the recipe form's `IngredientRow` group for that line-group, bound
      to a local `DraftIngredient[]` seeded from `proposed` (full matching:
      pills, sub-units, autocomplete, force-match — the same components, so the
      same behavior). Edits update that entry's draft only.
    - **Per-entry checkbox, default UNCHECKED** (opt-in).
  - Footer: live counts ("X Änderungen in Y Rezepten ausgewählt") + "Anwenden"
    (disabled when nothing selected) + "Abbrechen".
- **Default state: everything unchecked.** The user opts in per entry/recipe.

### 5. New-ingredient handling (reuses the normal save flow)
On "Anwenden":
1. Collect selected entries' final rows (proposed, with any edits).
2. Gather candidate new-ingredient names = rows that are unmapped (no
   `selectedIngredientId`, not `unassigned`).
3. `POST /api/v1/ingredients/check` with those names → `{ newNames }`.
4. If `newNames` is non-empty, open the existing **`NewIngredientsDialog`** to
   collect per-name `NewIngredientDefaults` (category / dietary / default unit).
5. Call apply with the selection + `newIngredientDefaults`.

This is the same `check → NewIngredientsDialog → submit` path the recipe form
already uses, so new ingredients are created with the same metadata UX.

### 6. Apply endpoint — `POST /api/v1/recipes/reparse-apply`
Payload (only checked entries):
```ts
{
  recipes: Array<{
    recipeId: number;
    replacements: Array<{
      replaceRowIds: number[];          // current group rows to replace
      rows: RecipeIngredientInput[];    // edited/proposed rows; rawLine kept = original line
    }>;
  }>;
  newIngredientDefaults?: NewIngredientDefaults[];
}
```
Server, per recipe (sequential; one transaction each):
1. Load the recipe (sections + ingredients, like the edit page does).
2. Rebuild each section's `RecipeIngredientInput[]`: walk current rows in order;
   when a row's id is the first of a `replaceRowIds` group, emit that group's
   `rows` (preserving `rawLine` = the original line so the result stays
   re-parseable); skip the other rows of the group; otherwise map the current row
   through unchanged.
3. Call the existing `updateRecipe` / `writeSections` with `newIngredientDefaults`.
   This reuses all current invariants: new-ingredient creation, alternative-link
   reconstruction (`alternativeForId`), `sortOrder`, and downstream shopping /
   meal-plan source handling — identical to a normal recipe edit.

Because recipes are updated sequentially with committed transactions, a new
ingredient name appearing in several recipes is created by the first recipe and
resolved by name in the rest (same as saving those recipes one by one). Returns a
summary `{ updatedRecipes, updatedGroups }`.

## Edge cases

- **Row with no `rawLine`:** never scanned, never touched.
- **Parser yields zero rows for a line:** treat as "not changed" / not listed
  (don't propose deleting a real ingredient because the line now reads as noise);
  mirrors the per-row re-parse guard.
- **Concurrent edit between scan and apply:** apply targets `replaceRowIds`; if a
  row id no longer exists in the recipe (recipe edited elsewhere in the meantime),
  that replacement is skipped and reported in the summary rather than failing the
  batch.
- **Equipment / optional defaults:** flow through `parsedIngredientToDraft` and
  the normal save, unchanged.
- **Alternatives:** a line-group is the whole primary+alternatives unit, so
  alternative restructuring (count changes) is handled by replacing the group.

## Performance (≈450 recipes)

- Scan is one server pass: in-process parser over all lines. Expected well under a
  few seconds; a spinner covers it. Only changed entries cross the wire; compact
  rows render eagerly, editable forms mount lazily on "Bearbeiten".
- Apply updates only the affected recipes, sequentially. If the changed set is
  very large, the modal scrolls; virtualization is deferred unless it's janky in
  practice.

## Files

- **New:** `src/app/api/v1/recipes/reparse-scan/route.ts`,
  `src/app/api/v1/recipes/reparse-apply/route.ts`,
  `src/components/recipes/bulk-reparse-dialog.tsx`,
  `src/lib/recipes/reparse-scan.ts` (server scan + shared change-detection helper),
  tests under `tests/`.
- **Modify:** `src/app/(app)/einstellungen/page.tsx` (entry button + dialog mount),
  reuse `NewIngredientsDialog`, `IngredientRow`/`IngredientGroup`,
  `parsedIngredientToDraft`, `updateRecipe`/`writeSections`, `buildPayload`-style
  row→input mapping.

## Testing

- **Change detection** (unit, hardest): identical → not changed; differing
  mapping / name / notes / qty / unit / sub-unit / optional / alt / row-count →
  changed; `null` vs `""` notes equivalence; quantity epsilon.
- **Scan grouping** (unit): contiguous same-`rawLine` rows form one group; rows
  without `rawLine` skipped; alternative groups kept whole.
- **Apply rebuild** (unit/service): a section with a replaced group rebuilds in
  order, other rows preserved, `rawLine` retained, alternative links intact;
  missing `replaceRowIds` skipped + reported.
- **New-ingredient path** (service): unmapped proposed rows create ingredients
  with provided defaults, deduped across recipes.
- UI: light — checkbox/selection counts and lazy edit mount; the heavy logic is
  covered above.

## Out of scope / future

- Batch undo, scan caching, scheduled/automatic re-parse, virtualized list.
