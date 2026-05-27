import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-autocomplete-umlaut-"));
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

async function seedIngredient(name: string): Promise<number> {
  const { db } = await import("@/db");
  const { ingredient } = await import("@/db/schema");
  const row = db
    .insert(ingredient)
    .values({ name })
    .returning({ id: ingredient.id })
    .all();
  return row[0].id;
}

beforeEach(async () => {
  const { db } = await import("@/db");
  const { ingredient, ingredientAlias } = await import("@/db/schema");
  db.delete(ingredientAlias).run();
  db.delete(ingredient).run();
});

describe("autocompleteItems with umlauts", () => {
  it("finds 'Brötchen' as the query grows past the umlaut", async () => {
    await seedIngredient("Brötchen");
    const { autocompleteItems } = await import("@/lib/shopping/items");

    // Sanity: the ASCII prefix already works today.
    expect(autocompleteItems("Br").map((h) => h.name)).toContain("Brötchen");
    // The bug: once the umlaut is typed, the suggestion must not vanish.
    expect(autocompleteItems("Brö").map((h) => h.name)).toContain("Brötchen");
    expect(autocompleteItems("brö").map((h) => h.name)).toContain("Brötchen");
    expect(autocompleteItems("Brötch").map((h) => h.name)).toContain("Brötchen");
  });

  it("stays diacritic-insensitive (ASCII query still finds the accented name)", async () => {
    await seedIngredient("Möhre");
    const { autocompleteItems } = await import("@/lib/shopping/items");
    expect(autocompleteItems("mohre").map((h) => h.name)).toContain("Möhre");
    expect(autocompleteItems("Möh").map((h) => h.name)).toContain("Möhre");
  });

  it("matches an alias containing an umlaut", async () => {
    const id = await seedIngredient("Haferflocken");
    const { db } = await import("@/db");
    const { ingredientAlias } = await import("@/db/schema");
    db.insert(ingredientAlias).values({ ingredientId: id, name: "Müsli" }).run();

    const { autocompleteItems } = await import("@/lib/shopping/items");
    expect(autocompleteItems("Mü").map((h) => h.name)).toContain("Haferflocken");
  });
});

describe("resolveByName with umlauts", () => {
  it("resolves a substring query that includes an umlaut", async () => {
    await seedIngredient("Brötchen");
    const { resolveByName } = await import("@/lib/shopping/byName");
    const res = resolveByName("Brö");
    expect(res.mode).toBe("match");
    if (res.mode === "match") expect(res.candidate.name).toBe("Brötchen");
  });
});
