# Ingredient "upcoming uses" lookup (from a meal context)

**Status:** approved 2026-05-28
**Drives epic:** standalone enhancement (touches planner + recipe view, no schema change)

## Problem

While cooking a planned meal, the user often grabs an ingredient (e.g. tomatoes, garlic, sour cream) and wonders: "do I need any of this for *other* meals coming up soon?" Today there's no quick way to answer that — they have to mentally scan the planner or click through each upcoming recipe.

## Goal

From a recipe opened *in the context of a specific planned meal*, surface per-ingredient: "yes — this is also needed for these upcoming meals, in these amounts." Make it fast (one tap), low-clutter, and discoverable.

## Out of scope (v1)

- Lookup from recipes opened without meal context (e.g. directly via `/rezepte/...` from the recipe list). The "future" anchor only makes sense relative to a specific planned date.
- Aggregating/converting cross-recipe quantities (no "total: 3.5 Stk" rollup). Each upcoming use is listed as-is with its own qty+unit, mirroring how the shopping preview surfaces them.
- Shopping-list awareness (no badging for "already on list"). Pure meal-plan view.
- A dedicated Home Assistant card. Endpoint is built with HA in mind but the integration ships later as part of Epic 12.

## UX

### Trigger

A small calendar icon button rendered **in its own column, immediately left of the dietary marker** on each ingredient row. The column always exists when the recipe is opened with meal context; the icon is rendered (or hidden, keeping the column width) per row depending on whether that ingredient has any upcoming use.

- Visible only when: (a) the recipe is opened with `mealPlanId` context, **and** (b) the ingredient row's canonical `ingredient_id` has at least one upcoming use strictly *after* the current meal's date within `mealDate + planner.days_visible` days.
- Hidden (but the column slot is reserved) otherwise — keeps the dietary marker / qty / name columns in alignment across rows.
- Equipment rows: never show the icon (consumable-only feature).
- Optional / alternative rows in the *current* recipe: still show the icon if the ingredient itself has upcoming uses.

### The popover

Tapping the calendar icon opens a popover (desktop) / bottom sheet (mobile) anchored to that row. Contents:

- Heading: `{Ingredient name}` (canonical)
- A short list, one row per upcoming use, sorted by date asc, then by `mealPlan.sortOrder`:
  - Date (`Mo 30.05.`) · recipe title · scaled quantity + unit
  - Optional rows: dimmed + `(optional)` tag, same as elsewhere
  - Notes: appended after qty with ` – ` separator, like the recipe page
- Empty popover is impossible — the icon only renders when there's at least one row.

Rows are **informational only in v1** (not navigable). Future work could turn them into links to the meal/recipe; punted to keep scope tight.

### Tooltip coexistence

The existing per-row tooltip (showing the canonical ingredient name when it differs from display name) stays as-is. The calendar icon is its own focusable button in its own column, so it doesn't collide with row-level tap-to-show-tooltip work (separately considered, not in this spec).

## Data flow

### Plumbing meal context

- `RecipePreviewDialog` already lives in the planner and knows the meal — extend its props to accept an optional `mealPlanId: number | null`.
- The "Vollansicht" link in the preview dialog appends `?meal=<mealPlanId>` when present.
- `/rezepte/[id]/page.tsx` reads `searchParams.meal` (a positive integer) and, when present, passes it down.
- Direct visits (`/rezepte/123` with no `?meal=…`) → no column rendered, behaves exactly as today.

### Endpoint

`GET /api/v1/meal-plans/[id]/upcoming-ingredient-uses`

**Auth:** session-only (mirrors the recipes/meal-plans GET endpoints — no API token needed for v1; the HA-facing variant lives under existing token auth in Epic 12 when we wire it up).

**Behavior:**
- Loads the meal by id, returns 404 if missing.
- Reads `planner.days_visible` from settings.
- Window: `start = mealDate + 1`, `length = daysVisible` → i.e. covers `[mealDate+1 … mealDate+daysVisible]`.
- Reuses the `previewMeals(start, length)` engine to scale quantities and apply the existing filters: drop `excludeFromShoppingList`, drop equipment, drop rows with no `ingredient_id` (Nicht zugeordnet). Optional + alternative rows are **kept** and flagged.
- Groups results by `ingredient_id` instead of by meal.

**Response shape:**

```ts
type UpcomingUse = {
  mealPlanId: number;
  date: string;            // ISO
  recipeId: number;
  recipeTitle: string;
  qty: number | null;      // already scaled
  unitName: string | null;
  notes: string | null;
  isOptional: boolean;
  alternativeForId: number | null;
};

type Response = {
  mealDate: string;        // echo for client-side sanity check
  daysVisible: number;
  byIngredientId: Record<number, UpcomingUse[]>;
};
```

### Client wiring

- Recipe page (server component) reads `?meal=<id>` and passes `mealPlanId` to a new thin client component wrapping the ingredient list, OR — simpler — keeps the server-rendered list and adds a client island per ingredient row that knows its own id.
- Implementation choice: a **single client island per ingredient list** that owns the fetch+popover state, and renders the icon inline via slot rendering. Avoids 1 island per row. Fetch happens once on mount with the meal id; result is cached in component state.
- `RecipePreviewDialog`: same island, instantiated with `mealPlanId` prop when opened from the planner; with `null` when opened from the shopping list (`RecipePreviewDialog` is also used by `shopping-list-view.tsx` — there the meal context is unknown so the feature is silently absent).

## Edge cases

- **Same-day other meals:** excluded. The user's instruction was "after the date" — strict greater-than.
- **Recipe with no `ingredient_id` (Nicht zugeordnet):** no calendar icon possible — can't establish identity.
- **The current meal itself in the window:** can't happen — the window starts at `mealDate + 1`.
- **Multiple meals of the same recipe upcoming:** each rendered as its own row in the popover.
- **`servingsOverride` vs `recipe.servings`:** quantities are scaled by `previewMeals`. Fixed-amount lines stay literal.
- **No upcoming meals at all in the window:** the endpoint returns `byIngredientId: {}`, so no icons render anywhere — column is still reserved but empty everywhere, which is visually neutral and avoids reflow when data loads.

## Files

**New**
- `src/app/api/v1/meal-plans/[id]/upcoming-ingredient-uses/route.ts` — endpoint.
- `src/lib/meal-plans/upcoming-uses.ts` — pure service function: `getUpcomingIngredientUses(mealPlanId): { mealDate, daysVisible, byIngredientId }`.
- `src/components/recipes/ingredient-upcoming-uses.tsx` — client island. Exposes a `<UpcomingUsesProvider>` (or hook) that fetches once and a `<UpcomingUsesButton ingredientId={…} />` that renders the icon + popover.
- `tests/upcoming-uses.test.ts` — unit tests for the service (window math, scaling, filter inheritance).

**Modified**
- `src/app/rezepte/[id]/page.tsx` — accept `?meal=<id>` in `searchParams`, wrap ingredient list with the provider, add the icon column.
- `src/components/planner/recipe-preview-dialog.tsx` — accept `mealPlanId` prop, wrap ingredient list, add icon column. Vollansicht link carries `?meal=<id>` when present.
- `src/components/planner/planner-view.tsx` — pass `mealPlanId` to `RecipePreviewDialog` (currently only `recipeId` is tracked; track both).
- `src/components/shopping/shopping-list-view.tsx` — pass `mealPlanId={null}` (feature silently absent here).

**Untouched (deliberately)**
- `src/lib/shopping/preview.ts` — reused as-is from the new service; no changes needed.
- Schema / migrations — none.

## HA-readiness (deferred)

The endpoint shape (`byIngredientId` keyed by integer ingredient id, with `mealDate` echoed) is what an HA card would consume to render a "while you're cooking X, here's what else is coming up" tile. When Epic 12 picks up the remaining HA endpoints, this endpoint gets:

- Bearer-token auth (in addition to session).
- Absolute photo URL builder (X-Forwarded-Proto/Host) if we decide to surface recipe photos in HA.
- A line in `docs/integrations/home-assistant.md` showing the example config.

No further design work needed for HA — it's a consumer change, not an endpoint change.

## Testing

- Service unit tests: window math (`mealDate+1 .. +daysVisible`), scaling, equipment/exclude filters, optional pass-through, grouping by `ingredient_id`, empty result when no meals.
- The existing `previewMeals` test coverage carries through since we reuse it.
- Manual: open the planner, click a meal's preview, verify icons appear on rows whose ingredient is also in another upcoming meal; tap → popover shows the right scaled qty. Open the same recipe from the recipe list (no `?meal`) and verify no icons. Open `RecipePreviewDialog` from the shopping list and verify no icons.
