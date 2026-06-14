import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-quantifier-persistence-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

type Seeded = { mehlId: number; zweiId: number; einigeId: number };

async function seed(): Promise<Seeded> {
  const { db } = await import("@/db");
  const { ingredient, quantifier, recipe, recipeIngredient, recipeSection } =
    await import("@/db/schema");

  db.delete(recipeIngredient).run();
  db.delete(recipeSection).run();
  db.delete(recipe).run();
  db.delete(ingredient).run();
  db.delete(quantifier).run();

  const mehlId = db
    .insert(ingredient)
    .values({ name: "Mehl", dietaryClass: "vegan" })
    .returning({ id: ingredient.id })
    .all()[0].id;

  const zweiId = db
    .insert(quantifier)
    .values({ name: "zwei", value: 2 })
    .returning({ id: quantifier.id })
    .all()[0].id;
  const einigeId = db
    .insert(quantifier)
    .values({ name: "einige", value: null })
    .returning({ id: quantifier.id })
    .all()[0].id;

  return { mehlId, zweiId, einigeId };
}

function baseIngredient(over: Record<string, unknown>) {
  return {
    ingredientName: "Mehl",
    ingredientId: null as number | null,
    quantity: null as number | null,
    unitId: null as number | null,
    displayUnit: null as string | null,
    notes: null as string | null,
    isOptional: false,
    fixedAmount: false,
    isAlternative: false,
    ...over,
  };
}

function baseRecipe(ingredients: ReturnType<typeof baseIngredient>[]) {
  return {
    title: "Quantifier-Test",
    description: null,
    servings: 4,
    prepTimeMin: null,
    cookTimeMin: null,
    sourceUrl: null,
    photoPath: null,
    tags: [] as string[],
    sections: [{ title: null, instructions: "", ingredients }],
  };
}

describe("recipe_ingredient quantifier persistence", () => {
  let ids: Seeded;
  beforeAll(async () => {
    ids = await seed();
  });

  it("persists a numeric quantifier ref with quantity null and exposes its value", async () => {
    const { createRecipe, getRecipe } = await import("@/lib/recipes/service");
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");

    const id = createRecipe(
      baseRecipe([
        baseIngredient({
          ingredientId: ids.mehlId,
          quantity: null,
          quantifierId: ids.zweiId,
        }),
      ]),
    );

    const line = getRecipe(id)!.sections[0].ingredients[0];
    expect(line.quantifierId).toBe(ids.zweiId);
    expect(line.quantifierName).toBe("zwei");
    expect(line.quantifierValue).toBe(2);
    // The literal column stays null for a quantifier row.
    expect(line.quantity).toBeNull();

    // Belt-and-suspenders: the persisted column is null.
    const rows = db.select().from(recipeIngredient).all();
    const row = rows.find((r) => r.quantifierId === ids.zweiId)!;
    expect(row.quantity).toBeNull();
    expect(row.quantityLow).toBeNull();
  });

  it("persists an unspecified quantifier (value null) and exposes quantifierValue null", async () => {
    const { createRecipe, getRecipe } = await import("@/lib/recipes/service");

    const id = createRecipe(
      baseRecipe([
        baseIngredient({
          ingredientId: ids.mehlId,
          quantity: null,
          quantifierId: ids.einigeId,
        }),
      ]),
    );

    const line = getRecipe(id)!.sections[0].ingredients[0];
    expect(line.quantifierId).toBe(ids.einigeId);
    expect(line.quantifierName).toBe("einige");
    expect(line.quantifierValue).toBeNull();
    expect(line.quantity).toBeNull();
  });

  it("forces quantity/quantityLow null when a quantifierId is supplied (belt-and-suspenders)", async () => {
    const { createRecipe } = await import("@/lib/recipes/service");
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");

    const id = createRecipe(
      baseRecipe([
        // Caller leaks a quantity alongside the quantifier ref (preview shape).
        baseIngredient({
          ingredientId: ids.mehlId,
          quantity: 2,
          quantityLow: 1,
          quantifierId: ids.zweiId,
        } as Record<string, unknown>),
      ]),
    );

    const rows = db.select().from(recipeIngredient).all();
    const row = rows.find((r) => r.quantifierId === ids.zweiId && r.quantity === null);
    // The write path must have collapsed quantity/quantityLow to null.
    const all = rows.filter((r) => r.quantifierId === ids.zweiId);
    expect(all.every((r) => r.quantity === null && r.quantityLow === null)).toBe(true);
    expect(row).toBeTruthy();
    void id;
  });

  it("round-trips a normal numeric row unchanged (quantifierId null)", async () => {
    const { createRecipe, getRecipe } = await import("@/lib/recipes/service");

    const id = createRecipe(
      baseRecipe([
        baseIngredient({ ingredientId: ids.mehlId, quantity: 250 }),
      ]),
    );

    const line = getRecipe(id)!.sections[0].ingredients[0];
    expect(line.quantity).toBe(250);
    expect(line.quantifierId).toBeNull();
    expect(line.quantifierName).toBeNull();
    expect(line.quantifierValue).toBeNull();
  });
});

describe("recipe input validation: quantity/quantifier mutual exclusivity", () => {
  it("rejects a row carrying BOTH quantity and quantifierId", async () => {
    const { recipeInputSchema } = await import("@/lib/recipes/validate");
    const result = recipeInputSchema.safeParse(
      baseRecipe([
        baseIngredient({
          ingredientId: 1,
          quantity: 2,
          quantifierId: 3,
        } as Record<string, unknown>),
      ]),
    );
    expect(result.success).toBe(false);
  });

  it("accepts a quantifierId with quantity null", async () => {
    const { recipeInputSchema } = await import("@/lib/recipes/validate");
    const result = recipeInputSchema.safeParse(
      baseRecipe([
        baseIngredient({ ingredientId: 1, quantity: null, quantifierId: 3 }),
      ]),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a quantifierId alongside a unitId", async () => {
    const { recipeInputSchema } = await import("@/lib/recipes/validate");
    const result = recipeInputSchema.safeParse(
      baseRecipe([
        baseIngredient({
          ingredientId: 1,
          quantity: null,
          quantifierId: 3,
          unitId: 5,
        }),
      ]),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a normal numeric row (quantifierId omitted)", async () => {
    const { recipeInputSchema } = await import("@/lib/recipes/validate");
    const result = recipeInputSchema.safeParse(
      baseRecipe([baseIngredient({ ingredientId: 1, quantity: 100 })]),
    );
    expect(result.success).toBe(true);
  });
});
