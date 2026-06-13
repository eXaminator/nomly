# First-class Amount Ranges — Design

**Date:** 2026-06-13
**Status:** Approved for planning (autonomous implementation)

## Problem

Ingredient amounts are sometimes ranges ("2–3 EL", "100–200 g"). Today the
parser detects a range, resolves `quantity` to the HIGH bound, and folds the
original "lo-hi" text into the notes (`rangeExpression`). The low bound is not
stored structurally, the read view shows only the high value (the range lives in
the note), and the editor is a single freeform field.

## Goal

Make ranges first-class:
- Store the low bound structurally; the high bound stays in `quantity`.
- Display ranges as `low–high unit` in the recipe read view.
- Shopping uses only the HIGH amount (already the case) — the high is always
  required, the low is optional.
- Editor: single amount input by default; a small toggle between the amount and
  the unit reveals the optional low input only when wanted (or when the parser
  recognized a range).

## Decisions (from brainstorming)

- **Model:** `quantity` = HIGH (required when any amount); new nullable
  `quantity_low` = LOW. A range exists iff `quantity_low` is non-null.
- **Editor layout:** toggle is a small button **between the amount input and the
  unit dropdown**. Range mode reads `[low]–[high] [⇄] [unit]`; single mode
  `[high] [⇄] [unit]`. Toggling off clears the low value.
- **Validation:** blocking. In range mode, empty/non-numeric low or low ≥ high
  is a row error (inline message) that prevents save.
- **Scope:** recipe ingredients only — NOT the staple/shopping variant.
- **Open-ended expressions** ("bis 3", "ab 2") have no real low bound: they keep
  today's note behavior; only true `lo–hi` ranges become structured.

## Data model

Add to `recipe_ingredient` (`src/db/schema.ts`):

```
quantityLow: real("quantity_low")   // nullable; LOW bound of a range
```

Migration: new head `0039`, additive, applies cleanly (no backfill — existing
rows have null = single amount).

`quantity` is unchanged: it remains the single/high value. Range present ⇔
`quantity_low != null`. Shopping snapshots and servings scaling already key off
`quantity`, so they need no change for the "only the higher amount" rule.

## Parser (`src/lib/recipe-import/ast/...`)

The amount pass already computes both ends of a real range (it does
`Math.max(n1, n2)` for `quantity` and builds the `lo-hi` string). Extend the
output to carry a structured **`quantityLow: number | null`**:

- `AmountUnit` gains `quantityLow: number | null`.
- `numeric.ts` range parsing returns the low bound (the min of the parsed
  values) for a true multi-number range; `null` for an open-ended "bis X"/"ab X"
  form.
- The same-unit range shape in `amount-unit.ts` ("25 g – 50 g") sets
  `quantityLow = min(n1, n2)`, `quantity = max(n1, n2)`.

In `parse-line.ts`: when `quantityLow != null`, set it on the row and **suppress
folding `rangeExpression` into the notes** (the range is now the displayed
amount). When `quantityLow == null`, behavior is exactly as today (open-ended
ranges still render in notes).

`quantityLow` threads through the row types: server `ImportedIngredient` and
client `ParsedIngredientResponse` each gain `quantityLow: number | null`.

## Editor (`src/components/recipes/ingredient-row.tsx`, recipe variant only)

`DraftIngredient` gains `quantityLow: string` (German-formatted, like
`quantity`).

- Layout: `[high amount input]` `[⇄ toggle button]` `[unit dropdown]`. In range
  mode a `[low amount input]` plus an en-dash separator render to the LEFT of the
  high input: `[low]–[high] [⇄] [unit]`.
- Range mode is "on" when the row has a low value or the user toggled it on
  (local state seeded from `value.quantityLow !== ""`). Toggling off clears
  `quantityLow`.
- The toggle button is a small icon/text button (e.g. `⇄`) with an
  aria-label switching between "Mengenbereich" / "Einzelne Menge".
- The `quantityLow` input is disabled together with the high input when the unit
  is unspecific (consistent with the existing `amountDisabled`); an unspecific
  unit has no amount, so the range toggle is hidden in that case.

**Validation:** `ingredientToPayload` / the row-validity check treats a row as
invalid when range mode is active and (`quantityLow` empty/NaN OR low ≥ high).
The row shows an inline error and the save is blocked, matching existing
row-validation patterns.

`payload.ts` adds `quantityLow: number | null` (null when not in range mode).
The recipe create/update service persists `quantity_low`. `recipeToDraft`
repopulates `quantityLow` from the stored column (string-formatted), so editing a
saved range reopens with the toggle on and both fields filled. The import-draft
builder sets `quantityLow` from `ParsedIngredientResponse.quantityLow`.

## Display (`ingredient-read-line.tsx`, `src/lib/recipes/service.ts`)

- The read line receives `quantityLow` alongside `quantity`. When `quantityLow`
  is non-null, it renders `formatQuantity(low) + "–" + formatQuantity(high)`
  followed by the unit (e.g. `2–3 EL`, `1/2–1 TL` via existing fraction
  formatting). Otherwise unchanged.
- En-dash `–` separates the bounds.
- Where the recipe view scales amounts by a servings factor, both bounds scale
  proportionally (apply the same factor to `quantityLow`).
- The range no longer appears in the notes for structured ranges.

## Shopping list

No change. Contributions already use the single `quantity` (high bound); the low
bound never enters the shopping snapshot. A regression test locks this.

## Testing

- **Parser:** `2-3 EL` → `quantity=3, quantityLow=2`, no range text in notes;
  `100-200 g`; `bis 3 EL` → `quantity=3, quantityLow=null`, range stays in notes;
  a non-range single amount → `quantityLow=null`.
- **Payload/validation:** range with low ≥ high → invalid; empty low in range
  mode → invalid; valid range → both bounds serialized; toggle-off → `quantityLow
  = null`.
- **Display:** ranged row renders `low–high unit`; single row unchanged.
- **Round-trip:** persist a range via the recipe service, reload via
  `recipeToDraft` → low + high populated.
- **Shopping:** a ranged ingredient contributes only the high bound.

## Out of scope

- Staple / recurring-shopping-item ranges.
- Ranges in shopping aggregation math (low is display-only).
- Migrating existing notes that contain range text back into structured columns
  (only newly parsed/edited rows get structured ranges).
