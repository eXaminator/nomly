import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-fav-list-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

let userA: number;
let userB: number;
let rApple: number;
let rBread: number;

beforeEach(async () => {
  const { db } = await import("@/db");
  const { recipe, recipeFavorite, user } = await import("@/db/schema");
  db.delete(recipeFavorite).run();
  db.delete(user).run();
  db.delete(recipe).run();
  userA = db.insert(user).values({ sub: "a", name: "A", lastLoginAt: 1 }).returning({ id: user.id }).all()[0].id;
  userB = db.insert(user).values({ sub: "b", name: "B", lastLoginAt: 1 }).returning({ id: user.id }).all()[0].id;
  rApple = db.insert(recipe).values({ title: "Apfelkuchen" }).returning({ id: recipe.id }).all()[0].id;
  rBread = db.insert(recipe).values({ title: "Brot" }).returning({ id: recipe.id }).all()[0].id;
  const { toggleFavorite } = await import("@/lib/recipes/favorites");
  toggleFavorite(userA, rApple, true, 1); // A favorites Apfelkuchen
  toggleFavorite(userB, rBread, true, 1); // B favorites Brot
});

describe("listRecipes favorites", () => {
  it("isFavorite reflects currentUserId", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    const forA = listRecipes({ currentUserId: userA });
    expect(forA.find((r) => r.id === rApple)?.isFavorite).toBe(true);
    expect(forA.find((r) => r.id === rBread)?.isFavorite).toBe(false);
  });

  it("favoriteOfUserId filters to that user's favorites", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    const bs = listRecipes({ favoriteOfUserId: userB });
    expect(bs.map((r) => r.id)).toEqual([rBread]);
  });

  it("combines favorites filter with a text query (AND)", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    // A favorited Apfelkuchen; a query for "Brot" + A's favorites → empty.
    expect(listRecipes({ favoriteOfUserId: userA, query: "Brot" })).toHaveLength(0);
    expect(listRecipes({ favoriteOfUserId: userA, query: "Apfel" }).map((r) => r.id)).toEqual([rApple]);
  });

  it("no favorites context → isFavorite false", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    expect(listRecipes().every((r) => r.isFavorite === false)).toBe(true);
  });
});
