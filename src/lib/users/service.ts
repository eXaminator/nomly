import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { recipeFavorite, recipeTag, tag, user } from "@/db/schema";
import { tagForUserName } from "./favorite-seed";

export type UserRow = typeof user.$inferSelect;

export type UpsertInput = { sub: string; name: string; lastLoginAt: number };

/**
 * Insert-or-update a user by their OIDC `sub`. An existing user has their
 * `name` + `last_login_at` refreshed; a brand-new user is created and seeded
 * from tags once (see {@link seedFavoritesFromTags}). The caller supplies the
 * timestamp so the logic stays deterministic for tests.
 */
export function upsertUserFromSession(input: UpsertInput): UserRow {
  const existing = db.select().from(user).where(eq(user.sub, input.sub)).get();
  if (existing) {
    db.update(user)
      .set({ name: input.name, lastLoginAt: input.lastLoginAt })
      .where(eq(user.id, existing.id))
      .run();
    return { ...existing, name: input.name, lastLoginAt: input.lastLoginAt };
  }
  const inserted = db
    .insert(user)
    .values({
      sub: input.sub,
      name: input.name,
      lastLoginAt: input.lastLoginAt,
      // Stamp regardless of whether a mapping matches, so a non-matching user
      // isn't re-checked and a matched one isn't re-seeded.
      favoritesSeededAt: input.lastLoginAt,
    })
    .returning()
    .all()[0];
  seedFavoritesFromTags(inserted);
  return inserted;
}

/**
 * Insert a favorite for every recipe carrying the user's mapped tag (if any).
 * Idempotent via {@link onConflictDoNothing}. Called once, on user creation.
 */
function seedFavoritesFromTags(u: UserRow): void {
  const tagName = tagForUserName(u.name);
  if (!tagName) return;
  const t = db.select({ id: tag.id }).from(tag).where(eq(tag.name, tagName)).get();
  if (!t) return;
  const recipeIds = db
    .select({ recipeId: recipeTag.recipeId })
    .from(recipeTag)
    .where(eq(recipeTag.tagId, t.id))
    .all();
  if (recipeIds.length === 0) return;
  db.insert(recipeFavorite)
    .values(
      recipeIds.map((r) => ({
        userId: u.id,
        recipeId: r.recipeId,
        createdAt: u.lastLoginAt,
      })),
    )
    .onConflictDoNothing()
    .run();
}

export type UserListItem = { id: number; name: string; lastLoginAt: number };

export function listUsers(): UserListItem[] {
  return db
    .select({ id: user.id, name: user.name, lastLoginAt: user.lastLoginAt })
    .from(user)
    .orderBy(asc(user.name))
    .all();
}

/** Remove a user; their favorites cascade away. Returns false when no row
 *  matched. They reappear (and re-seed) on their next login. */
export function removeUser(id: number): boolean {
  return db.delete(user).where(eq(user.id, id)).run().changes > 0;
}
