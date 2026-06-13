import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { recipeFavorite } from "@/db/schema";

/**
 * Set or clear a single user's favorite for a recipe. Idempotent: adding an
 * existing favorite is a no-op (conflict ignored), removing a missing one too.
 * The caller supplies `now` so the logic stays deterministic for tests.
 */
export function toggleFavorite(
  userId: number,
  recipeId: number,
  favorite: boolean,
  now: number,
): void {
  if (favorite) {
    db.insert(recipeFavorite)
      .values({ userId, recipeId, createdAt: now })
      .onConflictDoNothing()
      .run();
  } else {
    db.delete(recipeFavorite)
      .where(
        and(
          eq(recipeFavorite.userId, userId),
          eq(recipeFavorite.recipeId, recipeId),
        ),
      )
      .run();
  }
}

/** The set of recipe ids a user has favorited — used to mark list/detail
 *  read models and to apply the favorites-by-user list filter. */
export function favoriteRecipeIdsForUser(userId: number): Set<number> {
  return new Set(
    db
      .select({ recipeId: recipeFavorite.recipeId })
      .from(recipeFavorite)
      .where(eq(recipeFavorite.userId, userId))
      .all()
      .map((r) => r.recipeId),
  );
}
