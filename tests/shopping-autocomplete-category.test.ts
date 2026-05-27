import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-autocomplete-cat-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  const tmpDb = drizzle(sqlite);
  migrate(tmpDb, { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { ingredient, category } = await import("@/db/schema");
  db.delete(ingredient).run();
  db.delete(category).run();
});

describe("autocompleteItems category", () => {
  it("returns the article's category name", async () => {
    const { db } = await import("@/db");
    const { ingredient, category } = await import("@/db/schema");
    const cat = db
      .insert(category)
      .values({ name: "Backwaren" })
      .returning({ id: category.id })
      .all()[0];
    db.insert(ingredient).values({ name: "Brötchen", defaultCategoryId: cat.id }).run();

    const { autocompleteItems } = await import("@/lib/shopping/items");
    const hit = autocompleteItems("Brötchen").find((h) => h.name === "Brötchen");
    expect(hit).toBeTruthy();
    expect(hit?.categoryName).toBe("Backwaren");
  });

  it("returns null category for an uncategorized article", async () => {
    const { db } = await import("@/db");
    const { ingredient } = await import("@/db/schema");
    db.insert(ingredient).values({ name: "Mehl" }).run();

    const { autocompleteItems } = await import("@/lib/shopping/items");
    const hit = autocompleteItems("Mehl").find((h) => h.name === "Mehl");
    expect(hit).toBeTruthy();
    expect(hit?.categoryName ?? null).toBeNull();
  });
});
