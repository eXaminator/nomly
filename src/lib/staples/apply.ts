import { asc, eq } from "drizzle-orm";
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

    const result: AddStapleGroupResult = {
      itemsCreated: 0,
      itemsIncremented: 0,
      itemsReactivated: 0,
      affectedItemIds: [],
    };

    for (const entry of entries) {
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
          stapleGroupName: head.name,
          contributedQuantity: entry.quantity,
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

    return result;
  });
}
