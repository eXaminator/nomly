import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-autocomplete-rank-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

async function insertIngredients(names: string[]) {
  const { db } = await import("@/db");
  const { ingredient } = await import("@/db/schema");
  for (const name of names) db.insert(ingredient).values({ name }).run();
}

beforeEach(async () => {
  const { db } = await import("@/db");
  const { ingredient } = await import("@/db/schema");
  db.delete(ingredient).run();
});

describe("autocompleteItems ranking", () => {
  it("ranks the exact match first", async () => {
    await insertIngredients(["Olivenöl", "Öl", "Aioli"]);
    const { autocompleteItems } = await import("@/lib/shopping/items");
    const hits = autocompleteItems("Öl");
    expect(hits[0]?.name).toBe("Öl");
  });

  it("surfaces real 'Öl' articles above incidental folded substrings (Aioli/Brokkoli)", async () => {
    await insertIngredients([
      "Aioli",
      "Brokkoli",
      "Olivenöl",
      "Sonnenblumenöl",
    ]);
    const { autocompleteItems } = await import("@/lib/shopping/items");
    const names = autocompleteItems("Öl").map((h) => h.name);

    // The articles that literally contain "öl" must precede the ones that only
    // match because accent-folding turned "ö" into "o" ("ai-ol-i", "brokk-ol-i").
    const olivenoel = names.indexOf("Olivenöl");
    const sonnenblumen = names.indexOf("Sonnenblumenöl");
    const aioli = names.indexOf("Aioli");
    const brokkoli = names.indexOf("Brokkoli");

    expect(olivenoel).toBeGreaterThanOrEqual(0);
    expect(sonnenblumen).toBeGreaterThanOrEqual(0);
    expect(olivenoel).toBeLessThan(aioli);
    expect(olivenoel).toBeLessThan(brokkoli);
    expect(sonnenblumen).toBeLessThan(aioli);
    expect(sonnenblumen).toBeLessThan(brokkoli);
  });

  it("ranks a word-start match above a mid-word substring", async () => {
    await insertIngredients(["Basmatireis", "Reis"]);
    const { autocompleteItems } = await import("@/lib/shopping/items");
    const names = autocompleteItems("Reis").map((h) => h.name);
    // "Reis" is exact (top); "Basmatireis" only matches mid-word.
    expect(names.indexOf("Reis")).toBeLessThan(names.indexOf("Basmatireis"));
  });

  it("still ranks word-start matches when the query has no diacritics", async () => {
    await insertIngredients(["Aioli", "Olivenöl"]);
    const { autocompleteItems } = await import("@/lib/shopping/items");
    // Typing "Ol" without the umlaut still matches both (accent-insensitive),
    // but "Olivenöl" starts with the query and must rank above "Aioli".
    const names = autocompleteItems("Ol").map((h) => h.name);
    expect(names.indexOf("Olivenöl")).toBeLessThan(names.indexOf("Aioli"));
  });
});
