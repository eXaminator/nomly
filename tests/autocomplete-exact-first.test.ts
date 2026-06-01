import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-autocomplete-exact-"));
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
  return db
    .insert(ingredient)
    .values({ name })
    .returning({ id: ingredient.id })
    .all()[0].id;
}

beforeEach(async () => {
  const { db } = await import("@/db");
  const { ingredient, ingredientAlias } = await import("@/db/schema");
  db.delete(ingredientAlias).run();
  db.delete(ingredient).run();
});

describe("autocompleteItems exact-match ordering", () => {
  it("puts the exact match first even when another match sorts earlier alphabetically", async () => {
    // "Apfelzucker" contains "zucker" and sorts before "Zucker" alphabetically.
    await seedIngredient("Apfelzucker");
    await seedIngredient("Zucker");
    const { autocompleteItems } = await import("@/lib/shopping/items");

    expect(autocompleteItems("Zucker")[0]?.name).toBe("Zucker");
  });

  it("treats an exact alias as an exact match (first), past alphabetical canonicals", async () => {
    await seedIngredient("Apfelzucker");
    const id = await seedIngredient("Haushaltszucker");
    const { db } = await import("@/db");
    const { ingredientAlias } = await import("@/db/schema");
    db.insert(ingredientAlias).values({ ingredientId: id, name: "Zucker" }).run();

    const { autocompleteItems } = await import("@/lib/shopping/items");
    expect(autocompleteItems("Zucker")[0]?.name).toBe("Haushaltszucker");
  });

  it("is diacritic-insensitive for exactness", async () => {
    await seedIngredient("Apfelmus");
    await seedIngredient("Müsli");
    const { autocompleteItems } = await import("@/lib/shopping/items");
    // "musli" (no umlaut) should still rank the exact "Müsli" first.
    expect(autocompleteItems("musli")[0]?.name).toBe("Müsli");
  });
});

describe("searchIngredients exact-match ordering", () => {
  it("puts the exact match first past an alphabetically-earlier substring match", async () => {
    await seedIngredient("Apfelzucker");
    await seedIngredient("Zucker");
    const { searchIngredients } = await import("@/lib/autocomplete");
    expect(searchIngredients("Zucker")[0]?.name).toBe("Zucker");
  });
});

describe("dropdownSuggestions", () => {
  it("keeps the exact match (first) when other suggestions exist", async () => {
    const { dropdownSuggestions } = await import("@/lib/autocomplete-ui");
    const out = dropdownSuggestions(
      [{ name: "garlic" }, { name: "garlic bulb" }],
      "garlic",
    );
    expect(out.map((h) => h.name)).toEqual(["garlic", "garlic bulb"]);
  });

  it("hides the dropdown when the exact match is the only suggestion", async () => {
    const { dropdownSuggestions } = await import("@/lib/autocomplete-ui");
    expect(dropdownSuggestions([{ name: "garlic" }], "garlic")).toEqual([]);
  });

  it("treats exactness case- and whitespace-insensitively", async () => {
    const { dropdownSuggestions } = await import("@/lib/autocomplete-ui");
    expect(dropdownSuggestions([{ name: "Zucker" }], "  zucker ")).toEqual([]);
  });

  it("returns all suggestions when none is an exact match", async () => {
    const { dropdownSuggestions } = await import("@/lib/autocomplete-ui");
    const out = dropdownSuggestions(
      [{ name: "garlic" }, { name: "garlic bulb" }],
      "garli",
    );
    expect(out).toHaveLength(2);
  });
});
