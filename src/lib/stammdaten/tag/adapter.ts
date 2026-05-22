import { and, eq, inArray } from "drizzle-orm";

import { recipeTag, tag } from "../../../db/schema.ts";
import type { MergeAdapter } from "../shared/types.ts";

export type TagRow = { id: number; name: string };

export const tagAdapter: MergeAdapter<TagRow> = {
  kind: "tag",
  table: tag,
  idColumn: tag.id,
  nameColumn: tag.name,
  aliasTable: null,
  aliasParentColumn: null,
  aliasNameColumn: null,
  fkRewires: [
    {
      table: recipeTag,
      column: recipeTag.tagId,
      refLabel: "recipes",
    },
  ],
  customRewires: (tx, winnerId, loserIds) => {
    // recipe_tag has a composite PK on (recipe_id, tag_id). For each
    // loser-referencing row, if the winner already tags that recipe, drop
    // the loser-side row; otherwise rewire it. After this hook, the bulk
    // UPDATE in `fkRewires` is a no-op.
    const winnerRecipeIds = new Set(
      tx
        .select({ id: recipeTag.recipeId })
        .from(recipeTag)
        .where(eq(recipeTag.tagId, winnerId))
        .all()
        .map((r) => r.id),
    );
    const loserRows = tx
      .select({ recipeId: recipeTag.recipeId, tagId: recipeTag.tagId })
      .from(recipeTag)
      .where(inArray(recipeTag.tagId, loserIds))
      .all();
    for (const row of loserRows) {
      if (winnerRecipeIds.has(row.recipeId)) {
        tx.delete(recipeTag)
          .where(
            and(
              eq(recipeTag.recipeId, row.recipeId),
              eq(recipeTag.tagId, row.tagId),
            ),
          )
          .run();
      } else {
        tx.update(recipeTag)
          .set({ tagId: winnerId })
          .where(
            and(
              eq(recipeTag.recipeId, row.recipeId),
              eq(recipeTag.tagId, row.tagId),
            ),
          )
          .run();
        winnerRecipeIds.add(row.recipeId);
      }
    }
  },
};
