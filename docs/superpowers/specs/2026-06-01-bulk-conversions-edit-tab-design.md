# Bulk conversions — grouped edit/delete tab

## Problem

The bulk-conversion dialog (`BulkConversionDialog`) can only *add* one
conversion edge across selected articles. There's no way to edit or remove
conversions the selected articles already carry, except one article at a time
in the edit drawer. Selecting "all oils" to fix a wrong `ml→g` factor, or to
drop a stray edge, still means opening each article.

## Goal

Add a grouped management view: across the selected articles, list the
conversions that already exist, collapse identical ones into a single entry,
and let the user edit the factor/container or delete the edge for all articles
sharing that entry at once.

## Decisions (settled in brainstorming)

- **Entry point:** the selection-bar button is renamed **"Umrechnungen"** and
  the dialog gets two tabs — **Hinzufügen** (the existing add + conflict-review
  flow, unchanged) and **Bearbeiten** (this new view).
- **Grouping:** exact-match only. Group key = `(fromUnitId, toUnitId, factor,
  isContainer)`. `ml→g =0.9` and `ml→g =0.92` are two separate entries.
- **Per entry:** editable factor + Gebinde checkbox, the list of affected
  articles (names, truncated to ~5 with "+N"), **Speichern** and **Löschen**.
- **Apply model:** per entry, immediate — each row's Speichern/Löschen fires
  its own request; no staged batch.

## Design

### Dialog restructure

`BulkConversionDialog` gains a `tab` state (`"add" | "edit"`) with a simple tab
switcher at the top. The existing add flow (steps 1–2) moves under the `add`
tab verbatim. The selection-bar button label in `ingredient-page-client.tsx`
changes from "Umrechnung hinzufügen" to "Umrechnungen".

### Bearbeiten tab — grouping

Derived client-side from a **local working copy** of the selected articles'
`conversions[]` (seeded from the `selectedItems` prop). Build a map keyed by
`${fromUnitId}|${toUnitId}|${factor}|${isContainer}`:

```
{
  key, fromUnitId, fromUnitName, toUnitId, toUnitName,
  factor, isContainer,
  articleIds: number[], articleNames: string[]
}
```

Entries sorted by `fromUnitName`, then `toUnitName`, then `factor`. Empty state
("Keine Umrechnungen vorhanden.") when no selected article has any conversion.

Each entry renders `1 {from} = {factor-input} {to}`, a Gebinde checkbox, the
affected-article names (first 5 comma-joined, then "+N weitere"), and Speichern
(enabled only when the draft factor/container differs from the entry value) +
Löschen buttons. Draft factor/container are local state keyed by entry key.

### Apply — per entry, immediate

- **Speichern** → `POST /api/v1/ingredients/bulk-conversions` with
  `{ fromUnitId, toUnitId, factor: <draft>, isContainer: <draft>, addIds: [],
  overwriteIds: <entry.articleIds> }`. Reuses the existing `bulkAddConversion`
  overwrite path — those articles all already have the `(from→to)` row, so it
  updates factor + container in place. No new server code for edit.
- **Löschen** → `DELETE /api/v1/ingredients/bulk-conversions` with
  `{ fromUnitId, toUnitId, ids: <entry.articleIds> }`.

After a successful op, update the local working copy (rewrite/remove the edge on
those article ids) and re-derive groups — so editing `=0.9` to `=0.92` visibly
merges into the `=0.92` group, and a delete drops the row. A `dirty` flag is
set. On dialog close, if `dirty`, call the existing `onApplied` once (clears
selection + `router.refresh()` so the list's inline summary column updates).

### Server — delete

New `bulkDeleteConversion(fromUnitId, toUnitId, ids): { deletedIds }` in
`ingredient/service.ts`: deletes `ingredient_unit_conversion` rows matching the
`(from, to)` pair for the given ingredient ids, returns the ids that had a row
removed. No-op (`deletedIds: []`) when `ids` is empty or no row matches.

New `DELETE` handler on the existing `bulk-conversions/route.ts`: Zod body
`{ fromUnitId, toUnitId, ids: number[]≥1 }`, calls the service, fires
`publishShoppingChanged()`, returns the result.

## Tests

Service-level vitest for `bulkDeleteConversion`:
- removes the edge from the named articles only, leaving other articles' rows
- leaves an article's *other* conversions untouched
- no-op when the `(from→to)` pair isn't present
- no-op on empty `ids`

The edit (overwrite) path is already covered by the existing
`bulkAddConversion` overwrite tests.

## Out of scope

- "Override by base unit" collision semantics (grouped-edit chosen instead).
- Normalizing differing factors across articles into one (kept as separate
  entries by design).
- Bulk-editing more than the factor/container of an existing edge (e.g.
  changing the from/to units — that's effectively delete + add).
