import { eq, inArray } from "drizzle-orm";

import { supermarket, supermarketCategory } from "../../../db/schema.ts";
import type { MergeAdapter } from "../shared/types.ts";

export type SupermarketRow = { id: number; name: string };

export const supermarketAdapter: MergeAdapter<SupermarketRow> = {
  kind: "supermarket",
  table: supermarket,
  idColumn: supermarket.id,
  nameColumn: supermarket.name,
  aliasTable: null,
  aliasParentColumn: null,
  aliasNameColumn: null,
  fkRewires: [
    {
      table: supermarketCategory,
      column: supermarketCategory.supermarketId,
      refLabel: "categoryEntries",
    },
  ],
  customRewires: (tx, winnerId, loserIds) => {
    // supermarket_category is unique on (supermarket_id, category_id). For
    // each loser-referencing row, if winner already has that category, drop
    // the loser-side row (winner keeps its sort_order); otherwise rewire.
    const winnerCategoryIds = new Set(
      tx
        .select({ id: supermarketCategory.categoryId })
        .from(supermarketCategory)
        .where(eq(supermarketCategory.supermarketId, winnerId))
        .all()
        .map((r) => r.id),
    );
    const loserRows = tx
      .select({
        id: supermarketCategory.id,
        categoryId: supermarketCategory.categoryId,
      })
      .from(supermarketCategory)
      .where(inArray(supermarketCategory.supermarketId, loserIds))
      .all();
    for (const row of loserRows) {
      if (winnerCategoryIds.has(row.categoryId)) {
        tx.delete(supermarketCategory)
          .where(eq(supermarketCategory.id, row.id))
          .run();
      } else {
        tx.update(supermarketCategory)
          .set({ supermarketId: winnerId })
          .where(eq(supermarketCategory.id, row.id))
          .run();
        winnerCategoryIds.add(row.categoryId);
      }
    }
  },
};
