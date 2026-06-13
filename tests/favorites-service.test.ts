import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-fav-svc-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

let userId: number;
let recipeId: number;

beforeEach(async () => {
  const { db } = await import("@/db");
  const { recipe, recipeFavorite, user } = await import("@/db/schema");
  db.delete(recipeFavorite).run();
  db.delete(user).run();
  db.delete(recipe).run();
  userId = db.insert(user).values({ sub: "s1", name: "A", lastLoginAt: 1 }).returning({ id: user.id }).all()[0].id;
  recipeId = db.insert(recipe).values({ title: "R" }).returning({ id: recipe.id }).all()[0].id;
});

describe("toggleFavorite", () => {
  it("adds, is idempotent, and removes", async () => {
    const { toggleFavorite, favoriteRecipeIdsForUser } = await import("@/lib/recipes/favorites");
    toggleFavorite(userId, recipeId, true, 10);
    toggleFavorite(userId, recipeId, true, 20); // idempotent
    expect([...favoriteRecipeIdsForUser(userId)]).toEqual([recipeId]);
    toggleFavorite(userId, recipeId, false, 30);
    expect(favoriteRecipeIdsForUser(userId).size).toBe(0);
    toggleFavorite(userId, recipeId, false, 40); // remove missing → no-op
    expect(favoriteRecipeIdsForUser(userId).size).toBe(0);
  });
});
