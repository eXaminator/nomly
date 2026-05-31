import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-subunit-manage-"));
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

let zeheId = 0;
let blattId = 0;
let recipeIngredientId = 0;

beforeAll(async () => {
  const { db } = await import("@/db");
  const { ingredient, ingredientSubUnit, recipe, recipeSection, recipeIngredient } =
    await import("@/db/schema");

  const [knoblauch] = db
    .insert(ingredient)
    .values({ name: "Knoblauch" })
    .returning()
    .all();
  const [zehe] = db
    .insert(ingredientSubUnit)
    .values({ ingredientId: knoblauch.id, name: "Zehe", plural: "Zehen", perPurchase: 10 })
    .returning()
    .all();
  zeheId = zehe.id;
  const [blatt] = db
    .insert(ingredientSubUnit)
    .values({ ingredientId: knoblauch.id, name: "Blatt", plural: null, perPurchase: 1 })
    .returning()
    .all();
  blattId = blatt.id;

  const [r] = db.insert(recipe).values({ title: "Test" }).returning().all();
  const [s] = db
    .insert(recipeSection)
    .values({ recipeId: r.id, instructions: "" })
    .returning()
    .all();
  const [ri] = db
    .insert(recipeIngredient)
    .values({ sectionId: s.id, ingredientId: knoblauch.id, quantity: 4, subUnitId: zehe.id })
    .returning()
    .all();
  recipeIngredientId = ri.id;
});

describe("listSubUnitsManaged", () => {
  it("lists sub-units with ingredient name and usage count", async () => {
    const { listSubUnitsManaged } = await import("@/lib/stammdaten/sub-unit/service");
    const items = listSubUnitsManaged();
    const zehe = items.find((i) => i.id === zeheId)!;
    expect(zehe.ingredientName).toBe("Knoblauch");
    expect(zehe.plural).toBe("Zehen");
    expect(zehe.usageCount).toBe(1);
    const blatt = items.find((i) => i.id === blattId)!;
    expect(blatt.usageCount).toBe(0);
  });

  it("filters by query across ingredient/name/plural", async () => {
    const { listSubUnitsManaged } = await import("@/lib/stammdaten/sub-unit/service");
    expect(listSubUnitsManaged("zehen").map((i) => i.id)).toEqual([zeheId]);
    expect(listSubUnitsManaged("knoblauch").length).toBe(2);
  });
});

describe("updateSubUnit", () => {
  it("updates in place, preserving the row id and recipe reference", async () => {
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");
    const { updateSubUnit } = await import("@/lib/stammdaten/sub-unit/service");
    const { eq } = await import("drizzle-orm");

    const updated = updateSubUnit(zeheId, {
      name: "Knolle",
      plural: "Knollen",
      perPurchase: 12,
    });
    expect(updated.id).toBe(zeheId);
    expect(updated.name).toBe("Knolle");
    expect(updated.plural).toBe("Knollen");
    expect(updated.perPurchase).toBe(12);

    const ri = db
      .select({ subUnitId: recipeIngredient.subUnitId })
      .from(recipeIngredient)
      .where(eq(recipeIngredient.id, recipeIngredientId))
      .get();
    expect(ri?.subUnitId).toBe(zeheId);
  });

  it("rejects a rename that collides with a sibling sub-unit", async () => {
    const { updateSubUnit } = await import("@/lib/stammdaten/sub-unit/service");
    expect(() =>
      updateSubUnit(blattId, { name: "Knolle", plural: null, perPurchase: 1 }),
    ).toThrow();
  });
});

describe("deleteSubUnit", () => {
  it("deletes and nulls the recipe reference", async () => {
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");
    const { deleteSubUnit } = await import("@/lib/stammdaten/sub-unit/service");
    const { eq } = await import("drizzle-orm");

    deleteSubUnit(zeheId);
    const ri = db
      .select({ subUnitId: recipeIngredient.subUnitId })
      .from(recipeIngredient)
      .where(eq(recipeIngredient.id, recipeIngredientId))
      .get();
    expect(ri?.subUnitId).toBeNull();
  });
});
