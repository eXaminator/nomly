import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-users-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

let favTagRecipeIds: number[] = [];

beforeEach(async () => {
  const { db } = await import("@/db");
  const { recipe, recipeFavorite, recipeTag, tag, user } = await import("@/db/schema");
  db.delete(recipeFavorite).run();
  db.delete(recipeTag).run();
  db.delete(tag).run();
  db.delete(user).run();
  db.delete(recipe).run();

  const tagId = db
    .insert(tag)
    .values({ name: "Familywall-Favorit" })
    .returning({ id: tag.id })
    .all()[0].id;
  favTagRecipeIds = [];
  for (const title of ["A", "B"]) {
    const rid = db.insert(recipe).values({ title }).returning({ id: recipe.id }).all()[0].id;
    db.insert(recipeTag).values({ recipeId: rid, tagId }).run();
    favTagRecipeIds.push(rid);
  }
  // An untagged recipe — must NOT be seeded.
  db.insert(recipe).values({ title: "C" }).run();
});

describe("upsertUserFromSession", () => {
  it("creates a user and seeds favorites from the mapped tag, once", async () => {
    const { upsertUserFromSession } = await import("@/lib/users/service");
    const { favoriteRecipeIdsForUser } = await import("@/lib/recipes/favorites");

    const u = upsertUserFromSession({ sub: "s1", name: "Steven Weingärtner", lastLoginAt: 100 });
    expect(u.favoritesSeededAt).toBe(100);
    expect([...favoriteRecipeIdsForUser(u.id)].sort()).toEqual([...favTagRecipeIds].sort());

    // Second upsert (same sub): updates name + last_login, no duplicate favorites.
    const again = upsertUserFromSession({ sub: "s1", name: "Steven W.", lastLoginAt: 200 });
    expect(again.id).toBe(u.id);
    expect(again.name).toBe("Steven W.");
    expect(again.lastLoginAt).toBe(200);
    expect(favoriteRecipeIdsForUser(u.id).size).toBe(2);
  });

  it("stamps a non-matching user but seeds nothing", async () => {
    const { upsertUserFromSession } = await import("@/lib/users/service");
    const { favoriteRecipeIdsForUser } = await import("@/lib/recipes/favorites");
    const u = upsertUserFromSession({ sub: "s2", name: "Opa", lastLoginAt: 100 });
    expect(u.favoritesSeededAt).toBe(100);
    expect(favoriteRecipeIdsForUser(u.id).size).toBe(0);
  });

  it("removeUser deletes the user and cascades favorites", async () => {
    const { upsertUserFromSession, removeUser, listUsers } = await import("@/lib/users/service");
    const { favoriteRecipeIdsForUser } = await import("@/lib/recipes/favorites");
    const u = upsertUserFromSession({ sub: "s1", name: "Steven", lastLoginAt: 100 });
    expect(favoriteRecipeIdsForUser(u.id).size).toBe(2);
    expect(removeUser(u.id)).toBe(true);
    expect(listUsers()).toHaveLength(0);
    expect(favoriteRecipeIdsForUser(u.id).size).toBe(0);
  });
});
