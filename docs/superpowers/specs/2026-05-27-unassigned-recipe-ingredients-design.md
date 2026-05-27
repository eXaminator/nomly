# Unassigned (non-purchasable) recipe ingredients

**Date:** 2026-05-27
**Status:** Approved, ready for implementation

## Problem

Some recipe lines don't make sense as reusable articles and would never be
bought — e.g. *"übrige gehackte Gazpacho-Zutaten"*, a garnish made from
leftovers, or something you're simply expected to have at home. Today every
`recipe_ingredient` row **must** point to a canonical article
(`ingredient_id NOT NULL`), so there's no way to write such a line without
polluting the central article catalog and the shopping list.

We want recipe lines that:

- carry the usual amount (quantity + unit, scaling with servings), but
- are **not** linked to any article in the central catalog, and
- can **never** reach a shopping list.

This is distinct from the existing `ingredient.exclude_from_shopping_list` /
`is_equipment` flags, which mark *real articles* the user already owns
(Backpapier, …). An unassigned line is **not an article at all**.

## Approach (chosen: A — nullable FK, text in `display_name`)

A recipe-ingredient row gets a third mode. The pill UI in the row editor
already has two: a real candidate (`selectedIngredientId` set) and **"Neu"**
(`selectedIngredientId == null` → server *creates* a new article on save). We
add a third pill, **"Nicht zugeordnet"**, always present like the "Neu" pill.

- **DB discriminator:** `recipe_ingredient.ingredient_id IS NULL`. The row's
  text lives in the existing nullable `display_name` column.
- **Why a draft/wire flag is still needed:** in the draft + wire layer
  `selectedIngredientId == null` already means "Neu (create article)". So the
  draft and the server payload carry an explicit `unassigned` boolean to tell
  "create new article" apart from "leave unassigned". At rest, only unassigned
  rows have `ingredient_id NULL`.

Rejected alternatives: an explicit `kind` enum column (redundant with the NULL
FK — YAGNI); a hidden sentinel article (pollutes the catalog / `name` is
unique).

## Data model

`src/db/schema.ts` — `recipe_ingredient.ingredient_id` drops `.notNull()`.
It keeps `.references(() => ingredient.id, { onDelete: "restrict" })` (RESTRICT
only bites when non-null). Everything else is reused unchanged. For unassigned
rows `sub_unit_id` stays NULL (sub-units are article-specific). `display_name`
is the source of the line's text and must be non-empty for these rows.

### Migration (riskiest step)

Dropping `NOT NULL` in SQLite forces a **table rebuild** of `recipe_ingredient`
(`__new_recipe_ingredient` create → copy → drop → rename → recreate the two
indexes + the self-referencing `alternative_for_id` FK). Generated via
`npm run db:generate` (→ `drizzle/0021_*.sql`) and **inspected by hand** to
confirm it preserves all rows, indexes and foreign keys, and auto-applies
cleanly on container start (no manual steps — prod is live).

## Layers to change

### 1. Draft state — `src/components/recipes/types.ts`
Add `unassigned: boolean` (required) to `DraftIngredient`. Default `false` in
`emptyIngredient`, `emptyAlternative`, the inline `emptyRecipe` row, and
`parsedIngredientToDraft` (import never auto-produces unassigned rows — it's a
manual choice).

### 2. Pill UI — `src/components/recipes/ingredient-row.tsx`
- New `UnassignedPill` ("Nicht zugeordnet") rendered in `CandidatePills`,
  always, like `NewPill` (disabled only when the name field is empty — an
  unassigned line still needs its text). Gated to the recipe variant via an
  `allowUnassigned` prop so the **staple** variant never shows it.
- Selection states: candidate → `selectedIngredientId` set; "Neu" →
  `selectedIngredientId == null && !unassigned`; "Nicht zugeordnet" →
  `unassigned`. Picking it sets `unassigned: true, selectedIngredientId: null,
  canonicalName: null, subUnit: null, addAsAlias: false`. Picking any candidate
  / "Neu" / using the ↻ copy / force-match sets `unassigned: false`.
- `applyAutoSelect` gets a sticky guard at the top: `if (current.unassigned)
  return current;` — once a row is unassigned, typing won't silently re-link
  it; the user re-links by clicking a candidate or "Neu".

### 3. Wire payload + validation
- `src/lib/recipes/types.ts`: add `unassigned?: boolean` (default false) to
  `RecipeIngredientInput`. Make `RecipeIngredientView.ingredientId` and
  `.canonicalIngredientName` nullable (`number | null`, `string | null`).
- `src/lib/recipes/validate.ts`: `unassigned: z.boolean().default(false)` plus
  a `.refine` — when `unassigned` is true, `ingredientId` and `subUnitId` must
  be null. `ingredientName` stays `min(1)`.
- `src/components/recipes/recipe-form.tsx`:
  - `ingredientToPayload` sends `unassigned: ing.unassigned`, and when
    unassigned forces `ingredientId: null, subUnitId: null, addAsAlias: false`.
  - `onSubmit`'s new-ingredient name check excludes unassigned rows
    (`.filter((i) => i.ingredientId == null && !i.unassigned)`) so they don't
    trigger the "neue Zutaten" metadata dialog.

### 4. Server persistence — `src/lib/recipes/service.ts`
In `writeSections`'s per-line loop: when `ing.unassigned`, set
`ingredientId = null` and **skip** both `resolveIngredient()` (no article
created or looked up) and the alias-add. The existing INSERT already writes
`displayName: trimmedName`, so the text is preserved; only `ingredient_id`
becomes nullable.

### 5. Read + display
- `getRecipe` ingredient query: `innerJoin(ingredientTable)` → **`leftJoin`**
  so unassigned rows aren't dropped. `coalesce(display_name, ingredient.name)`
  still yields the text. `canonicalIngredientName` is null for these;
  `isEquipment` coalesces to `false`; the local `IngredientRow` type +
  `RecipeIngredientView` get the nullable fields. Diet derivation filters out
  `ingredientId === null` rows (an unknown side-product shouldn't change the
  recipe's diet badge — matches the list page, which innerJoins and already
  ignores them).
- `src/app/rezepte/[id]/bearbeiten/page.tsx`: guard the
  `canonicalIngredientName.toLowerCase()` against null and set
  `unassigned: i.ingredientId == null` (with `selectedIngredientId: null,
  canonicalName: null` for those rows) so editing round-trips.
- `src/components/recipes/ingredient-line.tsx`: `canonicalName: string | null`,
  guard the `.trim()`. Unassigned rows render as plain text (no article
  tooltip) — the natural, minimal distinction. No extra badge.

### 6. Shopping-list exclusion
- `src/lib/shopping/preview.ts`: the line query already `innerJoin`s
  `ingredient`, which drops unassigned rows; add an explicit
  `isNotNull(recipe_ingredient.ingredient_id)` filter for clarity.
- `src/lib/shopping/merge.ts`: `loadRecipeIngredients` does **not** join
  `ingredient`, so it must filter `ingredient_id IS NOT NULL` (a null
  aggregation key would be wrong). Defense-in-depth: also skip contributions
  where `r.ingredientId == null`.

Net effect: unassigned lines can never appear on, or contribute to, a shopping
list.

### 7. Staples — `src/components/settings/staples/staple-group-detail-client.tsx`
The staple editor reuses `IngredientRow` (`variant="staple"`). Add
`unassigned: false` to its inline draft so it typechecks; the "Nicht
zugeordnet" pill is hidden there via `allowUnassigned={false}` (an unassigned
staple is meaningless — staples must resolve to a buyable article).

## Testing

Extend `tests/recipes-service.test.ts` (temp SQLite + real migrations):
- `createRecipe` with an `unassigned: true` line persists `ingredient_id NULL`,
  creates **no** new `ingredient` row, and keeps `display_name`.
- `getRecipe` returns the row with `ingredientId: null`,
  `canonicalIngredientName: null`, and `ingredientName` = the text.
- `updateRecipe` round-trip preserves the unassigned row (still null FK).
- An unassigned line does not affect the recipe's diet derivation.

Add to `tests/shopping.test.ts` (or the relevant shopping test): a meal whose
recipe has an unassigned line never surfaces that line in `previewMeals`, and
`addMealsToList` never creates a shopping item for it.

`npm run typecheck`, `npm run lint`, and `npm run test` must pass. Manual
check: add an unassigned line in the recipe editor, save, view, edit
(round-trips), and confirm it's absent from "Mahlzeiten hinzufügen".

## Non-goals (YAGNI)

No sub-recipe linking; no reuse/autocomplete of unassigned text across recipes
(each is local text); no `kind` enum column; no import-time auto-detection.
Unassigned rows may still be `isOptional` and may be alternatives — no extra
restriction.
