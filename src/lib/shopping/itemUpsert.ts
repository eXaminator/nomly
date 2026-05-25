import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { ingredient, shoppingItem } from "../../db/schema.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const GRACE_WINDOW_SECONDS = 24 * 60 * 60;

export type UpsertResult = {
  itemId: number;
  created: boolean;
  reactivated: boolean;
};

/**
 * Find-or-create a shopping_item row for an ingredient, applying the 24 h
 * re-activate rule on previously-checked items. Shared by the meals add
 * flow and the staple-group add flow so both behave the same.
 *
 * Side effects:
 *   - created   → inserts a row with `categoryId = ingredient.defaultCategoryId`,
 *                 `version=1`, sortOrder appended.
 *   - reactivated → un-checks the existing row, clears manual quantity/unit,
 *                   bumps version, touches updatedAt.
 *   - neither   → bumps version + updatedAt only.
 */
export function upsertShoppingItemForIngredient(
  tx: Tx,
  ingredientId: number,
): UpsertResult {
  const existing = tx
    .select({
      id: shoppingItem.id,
      checked: shoppingItem.checked,
      checkedAt: shoppingItem.checkedAt,
    })
    .from(shoppingItem)
    .where(eq(shoppingItem.ingredientId, ingredientId))
    .get();

  if (!existing) {
    const defaultCategoryId =
      tx
        .select({ defaultCategoryId: ingredient.defaultCategoryId })
        .from(ingredient)
        .where(eq(ingredient.id, ingredientId))
        .get()?.defaultCategoryId ?? null;
    const maxSort =
      tx
        .select({ max: sql<number | null>`MAX(${shoppingItem.sortOrder})` })
        .from(shoppingItem)
        .get()?.max ?? -1;
    const itemId = tx
      .insert(shoppingItem)
      .values({
        ingredientId,
        quantity: null,
        unitId: null,
        categoryId: defaultCategoryId,
        checked: false,
        checkedAt: null,
        sortOrder: maxSort + 1,
        version: 1,
      })
      .returning({ id: shoppingItem.id })
      .all()[0].id;
    return { itemId, created: true, reactivated: false };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (
    existing.checked &&
    existing.checkedAt != null &&
    nowSec - existing.checkedAt < GRACE_WINDOW_SECONDS
  ) {
    tx.update(shoppingItem)
      .set({
        checked: false,
        checkedAt: null,
        quantity: null,
        unitId: null,
        version: sql`${shoppingItem.version} + 1`,
        updatedAt: sql`unixepoch()`,
      })
      .where(eq(shoppingItem.id, existing.id))
      .run();
    return { itemId: existing.id, created: false, reactivated: true };
  }

  tx.update(shoppingItem)
    .set({
      version: sql`${shoppingItem.version} + 1`,
      updatedAt: sql`unixepoch()`,
    })
    .where(eq(shoppingItem.id, existing.id))
    .run();
  return { itemId: existing.id, created: false, reactivated: false };
}
