# Recurring shopping items — staple groups — design

**Date:** 2026-05-25
**Status:** Draft (autonomous mode — assumptions called out in §11)
**Scope:** Shopping list (`/einkauf`) and a new settings page for managing staple groups.

## Goals

1. **Curated staple groups.** The user defines named groups of ingredients they regularly buy (e.g. "Wocheneinkauf", "Backen", "Großeinkauf 2x/Monat").
2. **One-tap add.** From the shopping page, a single tap adds an entire group's items to the running list — no per-item picking, no automatic scheduling.
3. **Merge with existing items.** When an ingredient is already on the list (from a meal plan or a manual add), the staple's default quantity is added as another contribution rather than creating a second row.
4. **Source-aware clear.** The "Liste leeren" dialog lists each staple group that has contributed to the current list and allows removing all items added by that group in one tick.

## Non-goals

- **No automatic scheduling.** No "Tuesday means add Wocheneinkauf". The user always triggers the add explicitly.
- **No frequency/cadence tracking** per item. No "Brot every 7 days" timers, no learning from check-off history.
- **No pantry/stock state.** We do not track what is in the user's home.
- **No multi-group membership.** An ingredient can sit in multiple groups (nothing prevents it), but groups are managed independently. We do not de-duplicate across groups at add time beyond what the per-ingredient merge already does.
- **No partial-group adds via the primary action.** Whole group, one tap. (User can manually delete items afterward — and may always create a smaller group instead.)

## Constraints

- The existing shopping-item invariant — *one `shopping_item` row per ingredient* — must be preserved (`src/lib/shopping/merge.ts`).
- The 24 h re-activate rule for checked items must apply to staple-group adds, the same way it applies to meal adds: re-adding a recently-checked ingredient un-checks it and the fresh contribution describes what's owed now.
- Staple-group adds must be **traceable back to their group**, so the "Liste leeren" dialog can offer per-group removal. They are modeled as a *new source type* (parallel to meal sources), not as opaque manual amounts.
- `ingredient.excludeFromShoppingList` is **ignored** when adding via a staple group: if the user put the ingredient in the group, they explicitly want it on the list. (The flag still applies to meal-plan-derived adds.)

## Data model

Three new tables. The first two define groups; the third tracks contributions to the shopping list — directly mirroring `shopping_item_source` but for staple groups instead of meal plans.

```ts
export const stapleGroup = sqliteTable("staple_group", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});

export const stapleGroupItem = sqliteTable(
  "staple_group_item",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id")
      .notNull()
      .references(() => stapleGroup.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredient.id, { onDelete: "cascade" }),
    /** Optional default quantity. NULL = no quantity preset; the add still
     *  writes a `shopping_item_staple_source` row (with NULL quantity) so the
     *  contribution is traceable, but it does not contribute to the displayed
     *  amount. */
    quantity: real("quantity"),
    /** Required when `quantity` is set, NULL otherwise. */
    unitId: integer("unit_id").references(() => unit.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("staple_group_item_unique").on(t.groupId, t.ingredientId),
    index("staple_group_item_group_idx").on(t.groupId),
  ],
);

/**
 * One row per "this shopping item received a contribution from this staple
 * group". Mirrors `shopping_item_source` exactly, except it points at a
 * staple_group / staple_group_item pair instead of a meal_plan /
 * recipe_ingredient pair. The read-side aggregator in items.ts sums these
 * alongside meal sources and manual amounts.
 */
export const shoppingItemStapleSource = sqliteTable(
  "shopping_item_staple_source",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => shoppingItem.id, { onDelete: "cascade" }),
    stapleGroupId: integer("staple_group_id")
      .notNull()
      .references(() => stapleGroup.id, { onDelete: "cascade" }),
    /** Nullable so deleting a single staple-group entry doesn't strip the
     *  history of past adds. The grouping in the clear dialog uses
     *  `stapleGroupId`, not this column. */
    stapleGroupItemId: integer("staple_group_item_id").references(
      () => stapleGroupItem.id,
      { onDelete: "set null" },
    ),
    contributedQuantity: real("contributed_quantity"),
    contributedUnitId: integer("contributed_unit_id").references(() => unit.id, {
      onDelete: "set null",
    }),
    addedAt: integer("added_at").notNull().default(now),
  },
  (t) => [
    index("shopping_item_staple_source_item_idx").on(t.itemId),
    index("shopping_item_staple_source_group_idx").on(t.stapleGroupId),
  ],
);
```

- `staple_group.name` is unique because the picker on `/einkauf` and the clear dialog refer to groups by name.
- `(groupId, ingredientId)` is unique — within one group an ingredient appears at most once. (Across groups: not constrained.)
- `staple_group_item.note` mirrors the per-row `note` users can already set on shopping items (e.g. "Vollkorn, nicht Toast"). When a staple-group add creates a brand-new shopping item, the note is copied over.
- **`stapleGroupId` on the source is `onDelete: cascade`.** Consequence: deleting a group definition in settings also strips its contributions from the running shopping list. We considered `set null` (keep the contribution but lose the back-link) and decided against it — the user has actively removed the group; surfacing it in the clear dialog or per-item editor as "deleted group" is more confusing than it's worth. See §11 #6.
- The shopping items themselves are NOT deleted by the cascade — if the item still has meal sources, manual amounts, or another staple group's source, it stays on the list. Items that lose their only contribution become "orphans" and are cleaned up by the shared orphan-cleanup helper (§9), which runs in the same transaction as the strip — both for the clear-by-group path and for the group-delete-in-settings path.

## Behavior — adding a group

Entry point: `addStapleGroupToList(groupId: number): AddStapleGroupResult` — invoked from the `/einkauf` page.

Wrapped in a single transaction. For each `staple_group_item` row (in `sortOrder`):

1. **Resolve the target shopping item** by ingredient via the shared upsert helper (see §9). This ensures one row per ingredient, applies the 24 h re-activate rule, and defaults `categoryId` from `ingredient.defaultCategoryId` on create.
2. **Insert a `shopping_item_staple_source` row** with `(itemId, stapleGroupId, stapleGroupItemId, contributedQuantity, contributedUnitId)`. `contributedQuantity` and `contributedUnitId` are `NULL` when the staple item has no default quantity. The row is written *regardless* of whether a quantity is set — its primary purpose is the traceability link the clear dialog needs.
3. **If the staple item has a note** AND the resulting shopping item has no note yet, copy it over. Otherwise leave the existing note alone (don't clobber a user-edited note from the list).

Return value mirrors `AddMealsResult`:

```ts
type AddStapleGroupResult = {
  itemsCreated: number;
  itemsIncremented: number;   // existing items that got a new source contribution
  itemsReactivated: number;
  affectedItemIds: number[];
};
```

**Idempotency:** Tapping the same group twice in a row writes a second `shopping_item_staple_source` row per item. For items with a default quantity this stacks (the aggregator sums them by dimension, exactly like two meal-adds for the same recipe); for items without a default quantity the second row is a duplicate marker that disappears once the user clears either the first or second add. Mirrors how "Mahlzeiten hinzufügen" behaves on duplicate adds. If this turns into a footgun in practice we can debounce or warn — not required by the design.

## Behavior — clearing by group

Extends the existing `clearShoppingListSelective` flow. The clear dialog now lists two sections (when populated): contributing meals (existing) and contributing staple groups (new).

`clearShoppingListSelective` accepts:

```ts
type ClearSelection = {
  mealPlanIds: number[];      // existing
  stapleGroupIds: number[];   // new
};
```

For each `stapleGroupId` in the selection:

1. Delete all `shopping_item_staple_source` rows with that `stapleGroupId`. Capture the set of `itemId`s touched.
2. For each touched item: if it now has no remaining `shopping_item_source` rows AND no remaining `shopping_item_staple_source` rows AND no `shopping_item_amount` rows AND no manually-edited `note`, delete the `shopping_item` row. (Same orphan rule as the meal-clear flow; see §5 in `meals.ts`.)

Meal-clear and staple-clear run in the same transaction so the orphan check sees the post-strip state for both.

**Edge case — group deleted from settings while items are still on the list:** the `onDelete: cascade` on `shopping_item_staple_source.stapleGroupId` strips the source rows automatically. We then run the same orphan cleanup so the user doesn't end up with empty zombie items. Implementation: the group-delete service function runs the cleanup inline within the same transaction. The user receives a toast: *"Gruppe gelöscht (n Artikel von der Einkaufsliste entfernt)"* if any items were dropped, otherwise just *"Gruppe gelöscht"*.

## UI — adding from `/einkauf`

A new button in the existing action bar (`shopping-list-view.tsx`), between "Mahlzeiten hinzufügen" and "Artikel hinzufügen":

```
[ Mahlzeiten hinzufügen ]  [ Standards… ]  [ Artikel hinzufügen ]  [ Liste leeren ]
```

Label: **"Standards…"** (the ellipsis signals a picker opens; matches the visual weight of the other buttons). Icon: `ListPlus` from `lucide-react`.

**Behavior:**
- Tap → opens a small dialog listing the groups (sorted by `sortOrder`, then name), each as a tap target showing the group name and an item-count chip (`12 Artikel`).
- Tap a group → fires `addStapleGroupToList`, closes the dialog, toasts `"<Group name> hinzugefügt (n Artikel)"`. List refresh via `router.refresh()` follows the existing pattern.
- Empty state: if no groups exist yet, the dialog shows a single CTA linking to the settings page. (The button itself stays visible regardless of group count — discoverability over conditional UI.)
- If only one group exists, the dialog still opens (no shortcut) — consistency over micro-optimization.

## UI — clearing by group

The existing `ClearListDialog` (`src/components/shopping/clear-list-dialog.tsx`) gains a second section beneath "Mahlzeiten":

```
[x] Alles entfernen
    Mahlzeiten
    [ ] Linsensuppe — Mo, 25.05. · 6 Artikel
    [ ] Pasta Bolognese — Mi, 27.05. · 5 Artikel
    Standards
    [ ] Wocheneinkauf · 12 Artikel
    [ ] Backen · 4 Artikel
```

- Each section header has its own "Alle / Keine" toggle (no global toggle — the two lists are independent).
- A staple-group checkbox shows "<group name> · n Artikel" where n is the count of *distinct* shopping items that have a `shopping_item_staple_source` from this group on the current list.
- The summary endpoint (see §7) returns both lists. Either may be empty; if both are empty and there are no manual-only items, the dialog says "Keine Einträge auf der Liste." as it does today.
- Submit posts the union: `{ mealPlanIds: number[], stapleGroupIds: number[] }`. `removeAll: true` still bypasses both selections.

The per-item edit dialog (`edit-item-dialog.tsx`) also gains a small "Aus Standards" sub-section listing staple-source contributions for that item, with the same delete affordance the meal sources already have. This lets the user trim a single accidental staple contribution without nuking the whole group.

## UI — managing groups in Einstellungen

A new settings page at `/einstellungen/standards`, listed in the settings nav next to "Zutaten", "Einheiten", etc.

**Page structure** (matches existing `/einstellungen/<stammdaten>` pages):

- **List view (top):** all groups with their item count and a small drag handle for `sortOrder`. Each row links to a detail view; an inline "Neue Gruppe" button at the top creates a group (modal: just the name).
- **Detail view (route `/einstellungen/standards/[id]`):** the group's name (editable inline) and its items.
- **Items table** within a group:
  - Columns: ingredient (autocomplete picker reusing `byName` / the existing ingredient combobox), quantity, unit, note, drag handle.
  - "Zutat hinzufügen" row at the bottom — type/pick an ingredient, optionally set quantity + unit + note, save.
  - Deleting an item is a row action.
  - Deleting the whole group is a destructive button at the bottom with a confirm.
- **Group-delete confirm.** When the user deletes a group that currently has contributions on the shopping list (`shopping_item_staple_source` rows exist for this group), the confirm dialog says *"Gruppe '<name>' enthält gerade n Artikel auf der Einkaufsliste. Diese werden entfernt."* — the user agreement covers both the group definition and the live contributions, since the cascade does both atomically.

Behavior details:
- Ingredient picker is the same one used by the recipe editor and `add-item-dialog.tsx`, so creating a new ingredient on the fly works the same way.
- When the user sets a quantity but no unit (or vice versa), save is blocked with a helper text — both or neither.
- Unit options are filtered by dimension only inasmuch as the existing pickers do; we don't enforce that the unit's dimension match anything in particular (the aggregator will key on the unit's dimension at read time).

## API surface

REST under `/api/v1/staple-groups`, matching the layout of `/api/v1/shopping`:

| Method  | Path                                        | Purpose                                    |
|---------|---------------------------------------------|--------------------------------------------|
| GET     | `/api/v1/staple-groups`                     | List all groups (with item counts).        |
| POST    | `/api/v1/staple-groups`                     | Create a group (body: `{ name }`).         |
| GET     | `/api/v1/staple-groups/[id]`                | Group detail with items.                   |
| PATCH   | `/api/v1/staple-groups/[id]`                | Rename a group, update `sortOrder`.        |
| DELETE  | `/api/v1/staple-groups/[id]`                | Delete a group. Response includes `{ shoppingItemsRemoved: number }` so the toast can be accurate. |
| POST    | `/api/v1/staple-groups/[id]/items`          | Add an item to the group.                  |
| PATCH   | `/api/v1/staple-groups/[id]/items/[itemId]` | Update an item (quantity, unit, note, sortOrder). |
| DELETE  | `/api/v1/staple-groups/[id]/items/[itemId]` | Remove an item from the group. (Does NOT strip past contributions on the running list — `stapleGroupItemId` becomes `NULL` on the source row.) |
| POST    | `/api/v1/shopping/add-staple-group`         | Apply a group to the list (body: `{ groupId }`). Returns `AddStapleGroupResult`. |

**Changes to existing shopping endpoints:**

- `GET /api/v1/shopping/summary` — response gains a `stapleGroups` array alongside `meals`:
  ```ts
  type ShoppingSummary = {
    meals: Array<{ mealPlanId; mealDate; recipeId; recipeTitle; itemCount }>;
    stapleGroups: Array<{ stapleGroupId: number; name: string; itemCount: number }>;
  };
  ```
- `POST /api/v1/shopping/clear` — schema gains `stapleGroupIds: number[]`. The `removeAll: true` branch is unchanged.

The "apply to list" endpoint lives under `/api/v1/shopping/...` rather than `/api/v1/staple-groups/...` because it mutates the shopping list, not the group. Consistent with how `/api/v1/shopping/add-meals` is grouped.

## Library layout

- `src/lib/staples/groups.ts` — CRUD for groups and group items. Pure data layer. The group-delete function transactionally cascades, captures touched item ids, and runs orphan cleanup.
- `src/lib/staples/apply.ts` — `addStapleGroupToList(groupId)`. Uses the shared upsert helper (§9) and the shared orphan-cleanup helper (§9).
- `src/lib/staples/clear.ts` — `clearStapleGroupsFromList(groupIds)`. Strips matching `shopping_item_staple_source` rows and runs orphan cleanup. Called by the shared selective-clear path.
- `src/lib/staples/types.ts` — shared row/view types.

We deliberately put staples under `src/lib/staples/`, not `src/lib/shopping/` — staples are a separate concept that *writes into* shopping, not a sub-concern of shopping itself.

The existing `src/lib/shopping/meals.ts::clearShoppingListSelective` is renamed / re-homed to `src/lib/shopping/clear.ts` (or kept where it is — see §9), with its signature extended to accept `stapleGroupIds` and to call `clearStapleGroupsFromList` for the staples portion. Single transaction; single orphan-cleanup pass at the end.

## Read-side: ShoppingItemView changes

`ShoppingItemView` (in `src/lib/shopping/items.ts`) gains a new array:

```ts
export type ShoppingItemStapleSourceView = {
  sourceId: number;
  stapleGroupId: number;
  stapleGroupName: string;
  contributedQuantity: number | null;
  contributedUnitId: number | null;
  contributedUnit: string | null;
};

// existing ShoppingItemView gains:
//   stapleSources: ShoppingItemStapleSourceView[];
```

The aggregator that builds the `amounts` array now sums `(meal-source contributions) + (staple-source contributions) + (manual amounts)` grouped by dimension. Manual amounts retain their per-dimension override semantics; the staple sources are additive like meal sources are.

## Refactor: extract two helpers

Two small helpers get extracted so the staples module and the existing meals flow share behavior. Both are targeted refactors that serve the feature; no free-standing cleanup.

### 1. `upsertShoppingItemForIngredient`

`src/lib/shopping/merge.ts` currently inlines the "find or create the shopping item for this ingredient, applying the 24 h re-activate rule" logic inside the meal-add transaction. We extract it into a function the staples module can reuse:

```ts
// src/lib/shopping/itemUpsert.ts (new file)

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type UpsertResult = {
  itemId: number;
  created: boolean;
  reactivated: boolean;
};

export function upsertShoppingItemForIngredient(
  tx: Tx,
  ingredientId: number,
): UpsertResult;
```

`merge.ts` is rewritten to call this; `apply.ts` calls it too. No behavior change to the meal-add flow — same SQL, same 24 h grace window, same default-category behavior.

### 2. `cleanupOrphanShoppingItems`

The current `meals.ts::stripMealContributions` cleans up items whose only contribution was the meal being removed. The same rule applies to staple-group clears and to group-deletes that cascade. Extract:

```ts
// src/lib/shopping/cleanup.ts (new file)

export function cleanupOrphanShoppingItems(
  tx: Tx,
  candidateItemIds: number[],
): { itemsDeleted: number };
```

It deletes any item from `candidateItemIds` that has no `shopping_item_source` rows AND no `shopping_item_staple_source` rows AND no `shopping_item_amount` rows AND a null `note`. (Same predicate the meal flow uses today, extended to consider the new source table.)

Callers:
- meal-clear / meal-delete-with-ingredients (existing path, behavior unchanged once the predicate accounts for the new table).
- staple-group-clear (new).
- staple-group-delete-in-settings (new, runs after the cascade).

## Error handling

- **Creating a group with a duplicate name:** the unique constraint surfaces a 409 with `{ error: "duplicate_name" }`. The UI shows an inline error on the name field.
- **Adding an ingredient that's already in the group:** 409 `{ error: "duplicate_ingredient" }`. The UI shows the existing row scrolled into view and a brief flash.
- **Quantity set without unit (or vice versa):** validated server-side; 400 `{ error: "incomplete_amount" }`. UI prevents reaching the server in normal flow.
- **Applying a group with zero items:** allowed, no-ops, returns `affectedItemIds: []`. The toast says `"<Group name> hat keine Artikel"`.
- **Applying a group that references an ingredient that has since been deleted:** the cascade on `staple_group_item.ingredientId` removes the entry first, so this is impossible by construction.
- **Clearing a group that no longer has contributions:** harmless — the strip touches zero rows, orphan cleanup touches zero items, the result is `{ itemsDeleted: 0 }`. The UI hides such groups from the dialog anyway.
- **Concurrent apply (two devices tapping the same group):** each writes its own `shopping_item_staple_source` rows. They stack. Same as concurrent meal-adds — the existing design accepts this.

## Testing plan

Unit tests, following the layout under `tests/`:

- `tests/staples-groups.test.ts` — CRUD: create, rename, sort, delete cascades, duplicate name, duplicate ingredient. Delete-with-live-contributions: the cascade strips sources and orphan cleanup removes items that had nothing else holding them up; items with meal sources or manual amounts survive.
- `tests/staples-apply.test.ts`:
  - Add to empty list → items created with `shopping_item_staple_source` rows; with/without default quantity.
  - Add when ingredient already on list (from a meal) → new staple source row, no second shopping item row.
  - Add when ingredient is checked, within 24 h → re-activated.
  - Add when ingredient is checked, outside 24 h grace → sweeper has already removed it, so it's a normal create.
  - Note copy-over (existing item with note vs. without).
  - `excludeFromShoppingList` ignored.
  - Two consecutive adds → two source rows, displayed amounts stack (idempotency note).
  - Apply with zero items → empty result, no source rows written.
- `tests/staples-clear.test.ts`:
  - Clear a group → all matching source rows stripped, orphan items deleted, items with other contributions survive.
  - Clear a group with no live contributions → no-op, no errors.
  - Clear group A and meal M in one call → both stripped, single orphan-cleanup pass leaves the list consistent.
  - Clear group A when item also has a manual amount → source rows stripped, manual amount preserved, item stays on list.
- `tests/shopping-summary.test.ts` — extends existing summary test to include `stapleGroups` payload.

E2E / smoke (manual, called out in the implementation plan):

- Create a group with a few items via settings, add it from `/einkauf`, verify the items appear in the right categories.
- With a meal already on the plan, add a staple group that overlaps → the item shows both contributions in the edit dialog.
- Open "Liste leeren", tick a staple group, confirm — those items disappear, others stay.
- Delete a group from settings while it has live contributions on the list → confirm dialog warns; on confirm the items disappear.

## §11 — Assumptions (made autonomously, flag if wrong)

These are choices made in the user's stead because they were straightforward enough to decide without another round of questions. Each is reversible.

1. **Button label & icon:** "Standards…" with `ListPlus`. Alt names considered: "Wiederkehrend hinzufügen" (too long), "Vorratsliste" (different meaning). Happy to rename.
2. **Settings route:** `/einstellungen/standards` and the German term "Standards". Could be "Wiederkehrend" or "Vorrat" instead.
3. **Group picker is a dialog**, not an inline dropdown — matches the visual weight of the meal-add and add-item dialogs and gives room for the empty state. A dropdown could work too but feels lighter than the other actions.
4. **Idempotency:** stacking on second tap is **allowed** (mirrors meal-add). Not deduped, not warned. If this turns into a footgun in practice we can dim the button for N minutes after the add, or add a "schon vor X Minuten hinzugefügt" hint.
5. **`excludeFromShoppingList` is overridden** by staple-group adds. Rationale: the user explicitly opted these ingredients into the group.
6. **Deleting a group cascades to live contributions.** When a group is deleted in settings, `shopping_item_staple_source` rows for it are dropped (cascade), and orphan items are cleaned up. The user is warned in the confirm. Alternative was to `set null` the link and surface "deleted group" in the clear dialog — rejected as more confusing than helpful.
7. **`stapleGroupItemId` on the source is nullable (`set null` on delete).** Removing a single item from a group does NOT strip the past contribution from the running list — it only loses the back-link to the specific entry. Users can still remove the contribution via the clear dialog or the per-item editor. Rationale: editing a group definition shouldn't retroactively rewrite history.
8. **No multi-group membership UI affordance.** Ingredients can be in multiple groups, but the editor shows only the current group's items. We do not surface "this ingredient is also in: …".
9. **`note` field on `staple_group_item`** is included (not flagged as a question) because the user's stated examples ("Brot", "Milch") often come with implicit qualifiers ("Vollkorn", "fettarm") that the existing per-row note field already captures elsewhere. Cheap to include, removes a footgun.
10. **Drag-handle reorder** in both the group list and the items table — the existing `/einstellungen/*` pages already use this pattern; consistency over inventing something new.
11. **Per-item edit dialog also shows staple sources** with delete affordance, symmetric with meal sources. This is the natural place to remove a single accidental staple contribution without clearing the whole group.

## Out of scope (deferred — write down so it doesn't drift in)

- Auto-scheduling. Date-based recurrence. Cadence. ML.
- Per-list cycle de-dup ("you already added this group today").
- "Add only items I haven't bought in N days."
- Pantry/stock state.
- Bulk import from a CSV / paste.
- Snapshotting the group name on the source row so deleted groups still appear in the clear dialog as "Wocheneinkauf (gelöscht)".
