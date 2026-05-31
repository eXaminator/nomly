# Shopping List: Transparent Positions, Manual Units, and "Auf Lager" Stock

**Date:** 2026-05-31
**Branch:** `feat/ingredient-custom-units` (continues on top)
**Status:** Approved for autonomous, phased implementation

## Summary

Seven improvements to the shopping list, unified by one idea: **every contribution
to an item's aggregated total is a visible, labelled "position"** — a planned meal,
a manual entry, a standard (staple) list, or an "Auf Lager" (in‑stock) subtraction.
When the math is `+ meal + meal + standard-list − auf-lager = total`, the user can
see and edit each term. The shopping view already models positives this way
(`shoppingItemSource`, `shoppingItemStapleSource`, `shoppingItemAmount`); this work
makes those positions fully legible, adds a unit to manual entries, adds a
subtracting "stock" position, and makes article (Stammdaten) edits propagate live to
the list while preserving offline‑first behaviour.

## Existing architecture (load‑bearing facts)

- **Aggregation** (`src/lib/shopping/items.ts:304-430` → `src/lib/units/convert.ts`)
  recomputes amounts from the *current* per‑ingredient conversion graph on every read.
  ⇒ unit‑rule changes already reflect on the next online fetch.
- **Category is snapshotted** in `shopping_item.category_id`, written once at creation
  from `ingredient.default_category_id` (`itemUpsert.ts:59`) and **never updated**.
  There is no per‑item category override anywhere. ⇒ category changes do *not* reflect.
- **Realtime** (`src/lib/shopping/realtime.ts`) is in‑process pub/sub; `publishShoppingChanged()`
  is called only from shopping routes. `server.mts` fans out to WS clients on the
  "shopping" topic; clients refetch + reconcile into IndexedDB. ⇒ Stammdaten edits send
  no push today.
- **Offline cache** (`src/lib/shopping/offline/db.ts`) stores the *fully computed*
  `ShoppingItemView` per item. Online‑first works because the cache holds the final view.
- **"Ident icon"** = `CornerDownRight` (`recipe-detail.tsx:212`), shown on alternatives.
  Add‑meals dialog currently shows alternatives only as a dimmed "optional" pill.
- **Add‑item dialog** (`add-item-dialog.tsx`) has no unit field; manual adds send
  `unitId: null` → dimension `"none"`. The API (`AddItemInput`) already accepts `unitId`.
- **Default unit resolution:** alias `default_unit_id` → ingredient `default_unit_id` →
  "Stück" fallback. Alias‑aware unit picker exists (`src/components/units/unit-picker.ts`).
- **Meal notes** (`meal_plan.note`) exist but are never loaded into the shopping view.

## Decisions (resolved autonomously)

1. **Stock is one row per item** (`shopping_item_stock`, unique on `item_id`) — the
   "fixed line". Amount + unit + persisted dimension, mirroring `shopping_item_amount`.
2. **Stock subtracts in base units within the matching connected component**, clamped
   at `max(0, …)`, *before* containerization (so we "buy whole packs of the remainder").
   Implemented by extending `aggregateContributions` with a `subtractions` list rather
   than feeding negative quantities (negatives break the container `ceil`). Stock whose
   unit shares no component with any positive contribution has no effect and emits no
   phantom line.
3. **Category becomes read‑derived** from `ingredient.default_category_id` in
   `listShoppingItems`. The `shopping_item.category_id` column is kept (still written on
   create) but no longer drives display — lowest‑risk way to make category edits live.
4. **Stammdaten propagation = realtime push, not new caching.** Relevant article/unit/
   category/supermarket‑category mutations call `publishShoppingChanged()`. Online clients
   refetch immediately; offline clients keep the cached view and reconcile on reconnect.
   No new offline stores are required.
5. **Alternatives in add‑meals** get the `CornerDownRight` icon + indent (reusing the
   recipe‑detail treatment); the "optional" pill is reserved for plain optionals.

## Data model changes

```ts
// src/db/schema.ts — NEW
export const shoppingItemStock = sqliteTable(
  "shopping_item_stock",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id").notNull()
      .references(() => shoppingItem.id, { onDelete: "cascade" }),
    quantity: real("quantity"),
    unitId: integer("unit_id").references(() => unit.id, { onDelete: "set null" }),
    // Persisted like shopping_item_amount.dimension so the aggregator groups
    // without a unit join. "none" when no unit.
    dimension: text("dimension", { enum: ["mass", "volume", "count", "none"] }).notNull(),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("shopping_item_stock_item_unique").on(t.itemId)],
);
```

Migration generated via `npx drizzle-kit generate` (next number after `0032`). No data
backfill. Clean, auto‑run on container start (per project constraint).

`ShoppingItemView` gains:
- `mealNote: string | null` on each `ShoppingItemSourceView` (from `meal_plan.note`).
- `stock: { quantity, unitId, unitName, dimension } | null`.
- Aggregated `amounts` already reflect the post‑stock remainder.

## Feature breakdown & phases

### Phase 1 — Transparent positions (display‑only, lowest risk)
- **(#1) Meal notes:** join `meal_plan.note` into the source query; expose as
  `source.mealNote`. Render on each meal position in `shopping-item-row.tsx` and
  `edit-item-dialog.tsx` (alongside the existing per‑recipe `recipeNotes`). Every
  ingredient that came from a noted meal shows that meal's note.
- **(#7) Standard‑list positions:** `stapleSources` already carry `stapleGroupName`.
  Ensure they render as labelled positions ("Standardliste: …") in the row's expanded
  breakdown and the edit dialog, exactly like meal positions, so the total is explainable.
- **(#3) Alternative ident icon:** in `add-meals-dialog.tsx` `IngredientCheckbox`, render
  `CornerDownRight` + indent for rows where `alternativeForId != null`; keep the "optional"
  pill only for non‑alternative optionals.

### Phase 2 — Manual entry units (#2)
- Add an alias‑aware unit picker to `add-item-dialog.tsx` and the manual‑amount controls
  in `edit-item-dialog.tsx`.
- On article pick/resolve, default the unit to the resolved ingredient/alias
  `default_unit_id` (with `default_unit_display` spelling) → fallback "Stück".
- Plumb `unitId` through `addItem`. Surface the default via a small server helper
  (resolve default unit for an ingredient id) consumed by the dialog.

### Phase 3 — "Auf Lager" stock (#5 + #6)
- **Schema + engine:** add `shopping_item_stock`; extend `aggregateContributions` with
  `subtractions` (clamp at 0 per component, pre‑container). `buildAggregatedAmounts`
  passes the stock contribution as a subtraction.
- **Edit dialog (#5):** a fixed "Auf Lager" line with amount + unit picker (default =
  ingredient default unit, changeable). Saving upserts the single stock row.
  When set, it shows as a distinct subtracting position ("Auf Lager: −X Einheit") in the
  item breakdown, and a small chip on the collapsed row — listed like meals.
- **Whole‑list check (#6):** a toolbar button opens a dialog listing every list item with
  an amount input + unit (default = current stock unit or ingredient default). Batch‑save
  upserts/clears stock rows. New endpoint `POST /api/v1/shopping/stock` (batch) plus
  `PUT/DELETE /api/v1/shopping/items/[id]/stock` for the single‑item edit.
- All stock mutations call `publishShoppingChanged()`.

### Phase 4 — Dynamic‑but‑cached article data (#4)
- **Read‑derived category:** `listShoppingItems` joins category via
  `ingredient.default_category_id` instead of `shopping_item.category_id`.
- **Realtime push on Stammdaten edits:** call `publishShoppingChanged()` from the article/
  unit/category/supermarket‑category mutation routes that affect shopping display:
  `ingredients/manage/*` (category, default unit, conversion edges), `units/manage/*` +
  `units/merge` (factor, container, plural), `categories/manage/*` + `categories/merge`
  (rename), `supermarkets/manage/*` + `supermarkets/bulk` (category mapping).
- Offline unchanged: cached `ShoppingItemView` keeps online‑first working; reconnect →
  WS/refetch → reconcile updates IndexedDB. "When online, immediately updates" is the WS push.

## Aggregation: stock subtraction detail

`aggregateContributions(contributions, subtractions, edges, units)`:
1. Build the graph from contributions **and** subtractions (so stock units join components).
2. Per component: `posBase = Σ contributions→base`, `subBase = Σ subtractions→base`,
   `baseTotal = max(0, posBase − subBase)`.
3. Emit a line **only if the component has a positive contribution** (stock alone never
   creates a line). Containerize / promote the clamped `baseTotal` as today.
4. A fully‑covered item shows `0` in its unit; the row may render a muted "auf Lager
   gedeckt" hint. The item is **not** auto‑checked or deleted.

## Error handling & edge cases

- Stock unit in a dimension with no matching contribution: stored, shown as a position,
  but mathematically inert (documented; no phantom negative line).
- Open‑ended contributions (`quantity == null`): unchanged; stock can't subtract from an
  unknown total — remainder stays the known sum minus stock, clamped at 0.
- Removing the last positive contribution while stock remains: no line emitted (item may
  be swept as empty by existing rules); stock row cascades on item delete.
- Offline: stock edits are not offline‑queued in this iteration (only check/uncheck is).
  Stock dialogs require connectivity, consistent with add/edit item dialogs today.

## Testing

- **Unit (vitest):** `convert.ts` subtraction — clamp at 0, pre‑container ceil of remainder,
  inert cross‑dimension stock, multi‑component. `items.ts` — read‑derived category,
  `mealNote` plumb‑through, stock upsert/clear, batch stock.
- **Integration:** add‑meals alternative icon; manual add default unit resolution.
- **E2E (playwright):** set stock in edit dialog → total drops; whole‑list stock dialog
  round‑trip; Stammdaten category change pushes to an open list.
- **`npm run build`** before pushing (RSC client/server boundary; CI parity).

## Out of scope (YAGNI)

- Multiple stock lines per item / per‑dimension stock.
- Offline queueing of stock mutations.
- Dropping the `shopping_item.category_id` column (kept to avoid a data migration; can be
  removed in a later cleanup).
- Per‑item manual category override (does not exist today; not requested).
