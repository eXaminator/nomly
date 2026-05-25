# Recurring shopping items — staple groups — design

**Date:** 2026-05-25
**Status:** Draft (autonomous mode — assumptions called out in §11)
**Scope:** Shopping list (`/einkauf`) and a new settings page for managing staple groups.

## Goals

1. **Curated staple groups.** The user defines named groups of ingredients they regularly buy (e.g. "Wocheneinkauf", "Backen", "Großeinkauf 2x/Monat").
2. **One-tap add.** From the shopping page, a single tap adds an entire group's items to the running list — no per-item picking, no automatic scheduling.
3. **Merge with existing items.** When an ingredient is already on the list (from a meal plan or a manual add), the staple's default quantity is added as another contribution rather than creating a second row.

## Non-goals

- **No automatic scheduling.** No "Tuesday means add Wocheneinkauf". The user always triggers the add explicitly.
- **No frequency/cadence tracking** per item. No "Brot every 7 days" timers, no learning from check-off history.
- **No pantry/stock state.** We do not track what is in the user's home.
- **No multi-group membership.** An ingredient can sit in multiple groups (nothing prevents it), but groups are managed independently. We do not de-duplicate across groups at add time beyond what the per-ingredient merge already does.
- **No partial-group adds via the primary action.** Whole group, one tap. (User can manually delete items afterward — and may always create a smaller group instead.)

## Constraints

- The existing shopping-item invariant — *one `shopping_item` row per ingredient* — must be preserved (`src/lib/shopping/merge.ts`).
- The 24 h re-activate rule for checked items must apply to staple-group adds, the same way it applies to meal adds: re-adding a recently-checked ingredient un-checks it and the fresh contribution describes what's owed now.
- Manual amounts from a staple-group add are indistinguishable from any other manual amount once written — they live in `shopping_item_amount` and are edited/deleted via the existing edit dialog. We do **not** introduce a third source type.
- `ingredient.excludeFromShoppingList` is **ignored** when adding via a staple group: if the user put the ingredient in the group, they explicitly want it on the list. (The flag still applies to meal-plan-derived adds.)

## Data model

Two new tables, both small and standalone:

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
    /** Optional default quantity. NULL = no quantity preset; adding the
     *  group creates the shopping item without a manual amount. */
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
```

- `name` is `unique` because the picker on `/einkauf` shows groups by name.
- `(groupId, ingredientId)` is unique — within one group an ingredient appears at most once. (Across groups: not constrained.)
- `note` mirrors the per-row `note` users can already set on shopping items (e.g. "Vollkorn, nicht Toast"). When the staple-group add creates a brand-new shopping item, the note is copied over.

No source-tracking table. Staple-group adds write to `shopping_item_amount` as plain manual amounts (see §5).

## Behavior — adding a group

Trigger: `addStapleGroupToList(groupId: number)` — invoked from the `/einkauf` page.

For each `staple_group_item` row (in `sortOrder`):

1. **Resolve the target shopping item** by ingredient, reusing the find-or-create + re-activate logic in `src/lib/shopping/merge.ts`. This ensures:
   - one row per ingredient,
   - recently-checked items are un-checked and have their manual quantity cleared (the existing 24 h grace rule),
   - the item's `categoryId` defaults from `ingredient.defaultCategoryId` on create.
2. **If the staple item has a quantity**, insert one `shopping_item_amount` row with `(quantity, unitId, dimension)` derived from the unit. This stacks with any existing meal-derived sources or other manual amounts (the read-side aggregator in `src/lib/shopping/items.ts` already groups by dimension).
3. **If the staple item has no quantity**, just ensure the shopping item exists. No `shopping_item_amount` row is written.
4. **If the staple item has a note** AND the resulting shopping item has no note yet, copy it over. Otherwise leave the existing note alone (don't clobber a user-edited note from the list).

Return value mirrors `AddMealsResult`:

```ts
type AddStapleGroupResult = {
  itemsCreated: number;
  itemsIncremented: number;   // existing items that got a new amount
  itemsReactivated: number;
  affectedItemIds: number[];
};
```

**Idempotency:** Tapping the same group twice in a row stacks a second manual amount onto each item with a default quantity. This is intentional — it mirrors how "Mahlzeiten hinzufügen" behaves when you add the same meal twice. Items without a default quantity are no-ops on the second tap (the row already exists, no new amount is written). If we observe accidental double-taps in practice we can add a debounce or "added X minutes ago" hint later; the design does not require it.

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
| DELETE  | `/api/v1/staple-groups/[id]`                | Delete a group (cascades to items).        |
| POST    | `/api/v1/staple-groups/[id]/items`          | Add an item to the group.                  |
| PATCH   | `/api/v1/staple-groups/[id]/items/[itemId]` | Update an item (quantity, unit, note, sortOrder). |
| DELETE  | `/api/v1/staple-groups/[id]/items/[itemId]` | Remove an item from the group.             |
| POST    | `/api/v1/shopping/add-staple-group`         | Apply a group to the list (body: `{ groupId }`). Returns `AddStapleGroupResult`. |

The "apply to list" endpoint lives under `/api/v1/shopping/...` rather than `/api/v1/staple-groups/...` because it mutates the shopping list, not the group. Consistent with how `/api/v1/shopping/add-meals` is grouped.

## Library layout

- `src/lib/staples/groups.ts` — CRUD for groups and group items. Pure data layer.
- `src/lib/staples/apply.ts` — `addStapleGroupToList(groupId)`. Uses the shared find-or-create-shopping-item helper extracted from `src/lib/shopping/merge.ts` (see §8).
- `src/lib/staples/types.ts` — shared row/view types.

We deliberately put staples under `src/lib/staples/`, not `src/lib/shopping/` — staples are a separate concept that *writes into* shopping, not a sub-concern of shopping itself.

## Refactor: extract the find-or-create helper

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

This is a targeted refactor that serves the feature; it falls within the "improvements as part of the design" guideline rather than a free-standing cleanup.

## Error handling

- **Creating a group with a duplicate name:** the unique constraint surfaces a 409 with `{ error: "duplicate_name" }`. The UI shows an inline error on the name field.
- **Adding an ingredient that's already in the group:** 409 `{ error: "duplicate_ingredient" }`. The UI shows the existing row scrolled into view and a brief flash.
- **Quantity set without unit (or vice versa):** validated server-side; 400 `{ error: "incomplete_amount" }`. UI prevents reaching the server in normal flow.
- **Applying a group with zero items:** allowed, no-ops, returns `affectedItemIds: []`. The toast says `"<Group name> hat keine Artikel"`.
- **Applying a group that references an ingredient that has since been deleted:** the cascade on `staple_group_item.ingredientId` removes the entry first, so this is impossible by construction.
- **Concurrent apply (two devices tapping the same group):** each writes its own `shopping_item_amount` rows. They stack. Same as concurrent meal-adds — the existing design accepts this.

## Testing plan

Unit tests, following the layout under `tests/`:

- `tests/staples-groups.test.ts` — CRUD: create, rename, sort, delete cascades, duplicate name, duplicate ingredient.
- `tests/staples-apply.test.ts`:
  - Add to empty list → items created, with/without default quantity.
  - Add when ingredient already on list (from a meal) → new manual amount stacked, no second row.
  - Add when ingredient is checked, within 24 h → re-activated.
  - Add when ingredient is checked, outside 24 h grace → sweeper has already removed it, so it's a normal create.
  - Note copy-over (existing item with note vs. without).
  - `excludeFromShoppingList` ignored.
  - Two consecutive adds → quantities stack (idempotency note).
  - Apply with zero items → empty result.

E2E / smoke (manual, called out in the implementation plan):

- Create a group with a few items via settings, add it from `/einkauf`, verify the items appear in the right categories.
- With a meal already on the plan, add a staple group that overlaps → the item shows both contributions in the edit dialog.

## §11 — Assumptions (made autonomously, flag if wrong)

These are choices made in the user's stead because they were straightforward enough to decide without another round of questions. Each is reversible.

1. **Button label & icon:** "Standards…" with `ListPlus`. Alt names considered: "Wiederkehrend hinzufügen" (too long), "Vorratsliste" (different meaning). Happy to rename.
2. **Settings route:** `/einstellungen/standards` and the German term "Standards". Could be "Wiederkehrend" or "Vorrat" instead.
3. **Group picker is a dialog**, not an inline dropdown — matches the visual weight of the meal-add and add-item dialogs and gives room for the empty state. A dropdown could work too but feels lighter than the other actions.
4. **Idempotency:** stacking on second tap is **allowed** (mirrors meal-add). Not deduped, not warned. If this turns into a footgun in practice we can dim the button for N minutes after the add, or add a "schon vor X Minuten hinzugefügt" hint.
5. **`excludeFromShoppingList` is overridden** by staple-group adds. Rationale: the user explicitly opted these ingredients into the group.
6. **No source tracking** for staple-group adds. They become opaque manual amounts the moment they hit the list. This matches the "fire and forget" semantics of the user's chosen merge model; if we later want a "remove everything from group X" action we'd need to extend with a third source table — out of scope here.
7. **No multi-group membership UI affordance.** Ingredients can be in multiple groups, but the editor shows only the current group's items. We do not surface "this ingredient is also in: …".
8. **`note` field on `staple_group_item`** is included (not flagged as a question) because the user's stated examples ("Brot", "Milch") often come with implicit qualifiers ("Vollkorn", "fettarm") that the existing per-row note field already captures elsewhere. Cheap to include, removes a footgun.
9. **Drag-handle reorder** in both the group list and the items table — the existing `/einstellungen/*` pages already use this pattern; consistency over inventing something new.

## Out of scope (deferred — write down so it doesn't drift in)

- Auto-scheduling. Date-based recurrence. Cadence. ML.
- Per-list cycle de-dup ("you already added this group today").
- "Add only items I haven't bought in N days."
- Pantry/stock state.
- Bulk import from a CSV / paste.
