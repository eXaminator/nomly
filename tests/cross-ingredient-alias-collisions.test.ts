import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-xalias-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

let createIngredient: typeof import("@/lib/stammdaten/ingredient/service").createIngredient;
let createUnit: typeof import("@/lib/stammdaten/unit/service").createUnit;
let findCrossIngredientAliasCollisions: typeof import("@/lib/stammdaten/ingredient/alias-collisions").findCrossIngredientAliasCollisions;

beforeAll(async () => {
  createIngredient = (await import("@/lib/stammdaten/ingredient/service")).createIngredient;
  createUnit = (await import("@/lib/stammdaten/unit/service")).createUnit;
  findCrossIngredientAliasCollisions = (
    await import("@/lib/stammdaten/ingredient/alias-collisions")
  ).findCrossIngredientAliasCollisions;
});

describe("findCrossIngredientAliasCollisions", () => {
  it("reports another ingredient sharing an alias, with its resolved unit", () => {
    const dose = createUnit({
      name: "Dose",
      plural: "Dosen",
      aliases: ["can"],
      aliasPlurals: {},
      dimension: "count",
      baseUnitId: null,
      factor: 1,
      isContainer: true,
      displayFraction: false,
    });
    const fresh = createIngredient({
      name: "Frischtomate",
      aliases: ["tomatoes"],
      defaultCategoryId: null,
      excludeFromShoppingList: false,
      dietaryClass: null,
    });
    createIngredient({
      name: "Dosentomate",
      aliases: ["tomatoes"],
      aliasUnitDefaults: [{ aliasName: "tomatoes", unitId: dose.id }],
      defaultCategoryId: null,
      excludeFromShoppingList: false,
      dietaryClass: null,
    });

    const hits = findCrossIngredientAliasCollisions("tomatoes", fresh.id);
    expect(hits.map((h) => h.ingredientName)).toContain("Dosentomate");
    expect(hits.find((h) => h.ingredientName === "Dosentomate")?.unitName).toBe("Dose");
    // The excluded ingredient never appears in its own collision list.
    expect(hits.every((h) => h.ingredientId !== fresh.id)).toBe(true);
    // A name nobody else uses → no collisions.
    expect(findCrossIngredientAliasCollisions("völlig-einzigartig", fresh.id)).toEqual([]);
  });
});
