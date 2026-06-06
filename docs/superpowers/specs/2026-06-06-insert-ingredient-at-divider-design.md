# Insert Ingredient at the Section Divider

**Date:** 2026-06-06
**Status:** Approved

## Problem

The recipe editor can append a row at the section bottom ("Zutat hinzufügen")
and split a section at a divider, but inserting a forgotten ingredient
mid-list means appending and dragging it into place.

## Design (approach A: twin overlay button)

- `IngredientGroup` (section-editor.tsx) gets an optional
  `onInsertAbove?: () => void`. When set (same condition as split:
  `primaryIdx > 0`, hidden while dragging), a second always-visible round
  icon button renders on the divider overlay next to the split button —
  `right-12` beside split's `right-3`, identical styling, `Plus` icon,
  title/aria "Zutat hier einfügen".
- `SectionEditor` implements `insertIngredientAt(i)`: splice
  `emptyIngredient()` into `section.ingredients` at the group's
  `primaryIdx`. Inserting before a primary never lands inside an
  alternatives group, so the adjacency invariant holds. Local section
  state only — no recipe-form involvement.
- Focus: pending-uid pattern (like recipe-form's `scrollToSectionUid`),
  local to `SectionEditor`. After the fresh row mounts, focus its first
  input (Menge) and `scrollIntoView({ block: "nearest" })`. To find the
  row, `IngredientRow`'s root element gets
  `id={"ingredient-row-" + value.uid}` (ingredient-row.tsx).

## Out of scope

- No insert affordance above the FIRST group (top-of-section) — rare, and
  the divider there carries no split button either.
- The bottom "Zutat hinzufügen" keeps its current no-focus behavior.

## Testing

One-line state splice; no pure helper extraction (split earned its helper
by doing cross-section surgery). Verification: existing suite, build,
manual editor check.
