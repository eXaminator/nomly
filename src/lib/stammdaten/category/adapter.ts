import { eq, inArray } from "drizzle-orm";

import {
  category,
  categoryAlias,
  ingredient,
  shoppingItem,
  supermarketCategory,
} from "../../../db/schema.ts";
import type { MergeAdapter } from "../shared/types.ts";

export type CategoryRow = { id: number; name: string };

export const categoryAdapter: MergeAdapter<CategoryRow> = {
  kind: "category",
  table: category,
  idColumn: category.id,
  nameColumn: category.name,
  aliasTable: categoryAlias,
  aliasParentColumn: categoryAlias.categoryId,
  aliasNameColumn: categoryAlias.name,
  fkRewires: [
    {
      table: ingredient,
      column: ingredient.defaultCategoryId,
      refLabel: "ingredients",
    },
    {
      table: shoppingItem,
      column: shoppingItem.categoryId,
      refLabel: "shoppingItems",
    },
    {
      table: supermarketCategory,
      column: supermarketCategory.categoryId,
      refLabel: "supermarketCategoryEntries",
    },
  ],
  customRewires: (tx, winnerId, loserIds) => {
    // supermarket_category has a uniqueness constraint on
    // (supermarket_id, category_id). Per supermarket where both winner and a
    // loser have a row, drop the loser's row (winner keeps its sort_order).
    // Where only the loser has a row, the generic bulk update will rewire it.
    const winnerSupermarketIds = new Set(
      tx
        .select({ id: supermarketCategory.supermarketId })
        .from(supermarketCategory)
        .where(eq(supermarketCategory.categoryId, winnerId))
        .all()
        .map((r) => r.id),
    );
    if (winnerSupermarketIds.size === 0) return; // No conflicts possible.
    const loserRows = tx
      .select({
        id: supermarketCategory.id,
        supermarketId: supermarketCategory.supermarketId,
      })
      .from(supermarketCategory)
      .where(inArray(supermarketCategory.categoryId, loserIds))
      .all();
    const idsToDelete: number[] = [];
    for (const row of loserRows) {
      if (winnerSupermarketIds.has(row.supermarketId)) idsToDelete.push(row.id);
    }
    if (idsToDelete.length > 0) {
      tx.delete(supermarketCategory)
        .where(inArray(supermarketCategory.id, idsToDelete))
        .run();
    }
  },
};

