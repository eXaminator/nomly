import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  shoppingItem,
  shoppingItemStapleSource,
  stapleGroup,
  stapleGroupItem,
} from "../../db/schema.ts";
import { upsertShoppingItemForIngredient } from "../shopping/itemUpsert.ts";
import { StapleGroupError } from "./groups.ts";

export type AddStapleGroupResult = {
  itemsCreated: number;
  itemsIncremented: number;
  itemsReactivated: number;
  affectedItemIds: number[];
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type StapleEntry = {
  id: number;
  ingredientId: number;
  quantity: number | null;
  unitId: number | null;
  note: string | null;
};

/**
 * Apply one staple-group entry to the list: upsert the shopping item, write a
 * traceable `shopping_item_staple_source` row (snapshotting the group name),
 * and copy the entry's note onto the item when the item has none yet.
 * `quantity` is the effective contribution (a per-item override, or the
 * entry's own preset).
 */
function applyStapleEntry(
  tx: Tx,
  result: AddStapleGroupResult,
  entry: StapleEntry,
  groupId: number,
  groupName: string,
  quantity: number | null,
): void {
  const upsert = upsertShoppingItemForIngredient(tx, entry.ingredientId);
  if (upsert.created) result.itemsCreated += 1;
  else if (upsert.reactivated) result.itemsReactivated += 1;
  else result.itemsIncremented += 1;
  result.affectedItemIds.push(upsert.itemId);

  tx.insert(shoppingItemStapleSource)
    .values({
      itemId: upsert.itemId,
      stapleGroupId: groupId,
      stapleGroupItemId: entry.id,
      stapleGroupName: groupName,
      contributedQuantity: quantity,
      contributedUnitId: entry.unitId,
    })
    .run();

  if (entry.note != null && entry.note !== "") {
    const current = tx
      .select({ note: shoppingItem.note })
      .from(shoppingItem)
      .where(eq(shoppingItem.id, upsert.itemId))
      .get();
    if (current && (current.note == null || current.note === "")) {
      tx.update(shoppingItem)
        .set({ note: entry.note })
        .where(eq(shoppingItem.id, upsert.itemId))
        .run();
    }
  }
}

function emptyResult(): AddStapleGroupResult {
  return {
    itemsCreated: 0,
    itemsIncremented: 0,
    itemsReactivated: 0,
    affectedItemIds: [],
  };
}

/**
 * Apply a staple group to the shopping list. For each entry in the group:
 *   - resolve the shopping item via the shared upsert helper (one row per
 *     ingredient, 24 h re-activate rule);
 *   - write one `shopping_item_staple_source` row, with NULL quantity/unit
 *     when the entry has no default amount (the row still serves as the
 *     traceability link the clear dialog needs);
 *   - copy the entry's note onto the shopping item when the item has no
 *     note yet — never clobber a user-edited note.
 *
 * `ingredient.excludeFromShoppingList` is ignored — putting the ingredient
 * in the group is an explicit opt-in.
 */
export function addStapleGroupToList(groupId: number): AddStapleGroupResult {
  return db.transaction((tx) => {
    const head = tx
      .select({ id: stapleGroup.id, name: stapleGroup.name })
      .from(stapleGroup)
      .where(eq(stapleGroup.id, groupId))
      .get();
    if (!head) {
      throw new StapleGroupError("not_found", "Gruppe nicht gefunden", 404);
    }
    const entries = tx
      .select()
      .from(stapleGroupItem)
      .where(eq(stapleGroupItem.groupId, groupId))
      .orderBy(asc(stapleGroupItem.sortOrder), asc(stapleGroupItem.id))
      .all();

    const result = emptyResult();
    for (const entry of entries) {
      applyStapleEntry(tx, result, entry, groupId, head.name, entry.quantity);
    }
    return result;
  });
}

export type StapleSelectionInput = {
  stapleGroupId: number;
  items: Array<{
    stapleGroupItemId: number;
    /** Optional per-item quantity override (in the item's unit). When omitted,
     *  the staple entry's own preset quantity is used. */
    quantity?: number | null;
  }>;
};

/**
 * Add a hand-picked subset of one or more standard lists to the shopping list,
 * with optional per-item quantity overrides. Backs the meals-style add dialog.
 * Unknown groups/items are skipped silently.
 */
export function addStapleSelectionToList(
  selection: StapleSelectionInput[],
): AddStapleGroupResult {
  return db.transaction((tx) => {
    const result = emptyResult();
    for (const sel of selection) {
      const itemIds = sel.items.map((i) => i.stapleGroupItemId);
      if (itemIds.length === 0) continue;
      const head = tx
        .select({ id: stapleGroup.id, name: stapleGroup.name })
        .from(stapleGroup)
        .where(eq(stapleGroup.id, sel.stapleGroupId))
        .get();
      if (!head) continue;

      const entries = tx
        .select()
        .from(stapleGroupItem)
        .where(
          and(
            eq(stapleGroupItem.groupId, sel.stapleGroupId),
            inArray(stapleGroupItem.id, itemIds),
          ),
        )
        .orderBy(asc(stapleGroupItem.sortOrder), asc(stapleGroupItem.id))
        .all();
      const overrideById = new Map(
        sel.items.map((i) => [i.stapleGroupItemId, i.quantity]),
      );

      for (const entry of entries) {
        const override = overrideById.get(entry.id);
        const quantity = override !== undefined ? override : entry.quantity;
        applyStapleEntry(tx, result, entry, sel.stapleGroupId, head.name, quantity);
      }
    }
    return result;
  });
}
