import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-recipe-plural-"));
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

let doseId = 0;
let knoblauchId = 0;
let zeheId = 0;

beforeAll(async () => {
  const { db } = await import("@/db");
  const { unit, unitAlias, ingredient, ingredientSubUnit } = await import("@/db/schema");

  const [dose] = db
    .insert(unit)
    .values({ name: "Dose", plural: "Dosen", dimension: "count" })
    .returning()
    .all();
  doseId = dose.id;
  db.insert(unitAlias).values({ unitId: dose.id, name: "can", plural: "cans" }).run();

  const [knoblauch] = db
    .insert(ingredient)
    .values({ name: "Knoblauch" })
    .returning()
    .all();
  knoblauchId = knoblauch.id;
  const [zehe] = db
    .insert(ingredientSubUnit)
    .values({ ingredientId: knoblauch.id, name: "Zehe", plural: "Zehen", perPurchase: 10 })
    .returning()
    .all();
  zeheId = zehe.id;
});

async function makeRecipe(line: {
  ingredientName: string;
  ingredientId: number | null;
  quantity: number;
  unitId: number | null;
  subUnitId: number | null;
  displayUnit: string | null;
}): Promise<number> {
  const { createRecipe } = await import("@/lib/recipes/service");
  return createRecipe({
    title: `T-${line.ingredientName}-${line.quantity}-${line.displayUnit ?? line.unitId}`,
    description: null,
    servings: 1,
    prepTimeMin: null,
    cookTimeMin: null,
    sourceUrl: null,
    photoPath: null,
    tags: [],
    sections: [
      {
        title: null,
        instructions: "",
        ingredients: [
          {
            ...line,
            notes: null,
            isOptional: false,
            fixedAmount: false,
            isAlternative: false,
          },
        ],
      },
    ],
  });
}

async function labelOf(id: number): Promise<string | null> {
  const { getRecipe } = await import("@/lib/recipes/service");
  return getRecipe(id)!.sections[0].ingredients[0].unitLabel;
}

describe("recipe read view — plural display", () => {
  it("shows the canonical plural for amounts other than 1", async () => {
    const id = await makeRecipe({
      ingredientName: "Tomaten",
      ingredientId: null,
      quantity: 3,
      unitId: doseId,
      subUnitId: null,
      displayUnit: null,
    });
    expect(await labelOf(id)).toBe("Dosen");
  });

  it("shows the canonical singular for exactly 1", async () => {
    const id = await makeRecipe({
      ingredientName: "Tomaten",
      ingredientId: null,
      quantity: 1,
      unitId: doseId,
      subUnitId: null,
      displayUnit: null,
    });
    expect(await labelOf(id)).toBe("Dose");
  });

  it("honours the matched alias's plural over the canonical", async () => {
    const id = await makeRecipe({
      ingredientName: "Tomaten",
      ingredientId: null,
      quantity: 2,
      unitId: doseId,
      subUnitId: null,
      displayUnit: "can",
    });
    expect(await labelOf(id)).toBe("cans");
  });

  it("pluralizes a sub-unit by amount", async () => {
    const id = await makeRecipe({
      ingredientName: "Knoblauch",
      ingredientId: knoblauchId,
      quantity: 4,
      unitId: null,
      subUnitId: zeheId,
      displayUnit: null,
    });
    expect(await labelOf(id)).toBe("Zehen");
  });
});
