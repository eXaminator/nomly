/**
 * A recipe_ingredient amount is EITHER a literal `quantity` OR a
 * `quantifier_id` reference whose quantifier carries a numeric `value`
 * (or null for an unspecified one like "einige"). The shopping list works
 * off snapshots: when a meal is added, the contribution's
 * `contributed_quantity` must be the EFFECTIVE quantity
 * (`quantity ?? quantifier.value`), not the bare literal `quantity`.
 *
 * - numeric quantifier ("zwei", value 2) → contributed_quantity 2 (then
 *   scaled by servings like any number).
 * - unspecified quantifier ("einige", value null) → effective null →
 *   contributed_quantity null → behaves exactly like a null-quantity row
 *   (check-off, contributes 0, never scales).
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-quantifier-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

type Ctx = {
  mealPlanId: number;
  riIds: {
    aepfelQuantifier: number; // "zwei" (value 2) Äpfel
    aepfelLiteral: number; // literal 3 Äpfel
    birnenEinige: number; // "einige" (value null) Birnen
    birnenNull: number; // bare null-quantity Birnen (baseline)
  };
  ingredientIds: { aepfel: number; birnen: number };
  unitIds: { stk: number };
  quantifierIds: { zwei: number; einige: number };
};

async function seed(): Promise<Ctx> {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");

  for (const t of [
    s.shoppingItemStapleSource,
    s.shoppingItemSource,
    s.shoppingItemAmount,
    s.shoppingItem,
    s.recipeIngredient,
    s.recipeSection,
    s.mealPlan,
    s.recipe,
    s.quantifierAlias,
    s.quantifier,
    s.ingredient,
    s.unit,
    s.category,
  ]) {
    db.delete(t).run();
  }

  const categoryId = db
    .insert(s.category)
    .values({ name: "Obst" })
    .returning({ id: s.category.id })
    .all()[0].id;
  const stkId = db
    .insert(s.unit)
    .values({ name: "Stk", dimension: "count", baseUnitId: null, factor: 1 })
    .returning({ id: s.unit.id })
    .all()[0].id;

  const mkIng = (name: string) =>
    db
      .insert(s.ingredient)
      .values({ name, defaultCategoryId: categoryId })
      .returning({ id: s.ingredient.id })
      .all()[0].id;
  const aepfel = mkIng("Äpfel");
  const birnen = mkIng("Birnen");

  const zweiId = db
    .insert(s.quantifier)
    .values({ name: "zwei", value: 2 })
    .returning({ id: s.quantifier.id })
    .all()[0].id;
  const einigeId = db
    .insert(s.quantifier)
    .values({ name: "einige", value: null })
    .returning({ id: s.quantifier.id })
    .all()[0].id;

  const recipeId = db
    .insert(s.recipe)
    .values({ title: "Obstsalat", servings: 2 })
    .returning({ id: s.recipe.id })
    .all()[0].id;
  const sectionId = db
    .insert(s.recipeSection)
    .values({ recipeId, title: null, instructions: "" })
    .returning({ id: s.recipeSection.id })
    .all()[0].id;

  const riRows = db
    .insert(s.recipeIngredient)
    .values([
      // "zwei" Äpfel: quantity null, quantifier value 2.
      { sectionId, ingredientId: aepfel, quantity: null, quantifierId: zweiId, unitId: null },
      // literal 3 Äpfel (the "other source").
      { sectionId, ingredientId: aepfel, quantity: 3, unitId: null },
      // "einige" Birnen: quantity null, quantifier value null.
      { sectionId, ingredientId: birnen, quantity: null, quantifierId: einigeId, unitId: null },
    ])
    .returning({ id: s.recipeIngredient.id })
    .all();

  // Separate recipe with a bare null-quantity Birnen row as the baseline the
  // "einige" row must match.
  const baselineSectionId = db
    .insert(s.recipeSection)
    .values({ recipeId, title: null, instructions: "" })
    .returning({ id: s.recipeSection.id })
    .all()[0].id;
  const baselineRi = db
    .insert(s.recipeIngredient)
    .values({ sectionId: baselineSectionId, ingredientId: birnen, quantity: null, unitId: null })
    .returning({ id: s.recipeIngredient.id })
    .all()[0].id;

  const mealPlanId = db
    .insert(s.mealPlan)
    .values({ recipeId, date: "2026-05-23", servingsOverride: null, sortOrder: 0 })
    .returning({ id: s.mealPlan.id })
    .all()[0].id;

  return {
    mealPlanId,
    riIds: {
      aepfelQuantifier: riRows[0].id,
      aepfelLiteral: riRows[1].id,
      birnenEinige: riRows[2].id,
      birnenNull: baselineRi,
    },
    ingredientIds: { aepfel, birnen },
    unitIds: { stk: stkId },
    quantifierIds: { zwei: zweiId, einige: einigeId },
  };
}

describe("shopping list snapshots the effective quantifier value", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("numeric quantifier (zwei=2) + literal 3 of the same article → aggregated 5", async () => {
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: [
          { recipeIngredientId: ctx.riIds.aepfelQuantifier },
          { recipeIngredientId: ctx.riIds.aepfelLiteral },
        ],
      },
    ]);
    const aepfel = listShoppingItems().find((i) => i.name === "Äpfel");
    expect(aepfel).toBeTruthy();
    // No unit → single dimension-"none" line summing 2 + 3.
    const total = aepfel!.amounts.reduce((sum, a) => sum + (a.quantity ?? 0), 0);
    expect(total).toBe(5);
  });

  it("unspecified quantifier (einige, value null) behaves like a bare null-quantity row", async () => {
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems } = await import("@/lib/shopping/items");

    // The "einige" row.
    addMealsToList([
      { mealPlanId: ctx.mealPlanId, ingredients: [{ recipeIngredientId: ctx.riIds.birnenEinige }] },
    ]);
    const einige = listShoppingItems().find((i) => i.name === "Birnen")!;
    const einigeSrc = einige.sources[0];
    const einigeAmount = einige.amounts.find((a) => a.dimension === "none");

    // Wipe and add the bare-null baseline row instead, to compare behavior.
    const { clearAllItems } = await import("@/lib/shopping/items");
    clearAllItems();
    addMealsToList([
      { mealPlanId: ctx.mealPlanId, ingredients: [{ recipeIngredientId: ctx.riIds.birnenNull }] },
    ]);
    const baseline = listShoppingItems().find((i) => i.name === "Birnen")!;
    const baselineSrc = baseline.sources[0];
    const baselineAmount = baseline.amounts.find((a) => a.dimension === "none");

    // Same snapshot contribution (null) and same aggregated amount (null).
    expect(einigeSrc.contributedQuantity).toBe(null);
    expect(einigeSrc.contributedQuantity).toBe(baselineSrc.contributedQuantity);
    expect(einigeAmount?.quantity ?? null).toBe(baselineAmount?.quantity ?? null);
    expect(einigeAmount?.quantity ?? null).toBe(null);
  });

  it("scaling: servingsOverride doubling scales a numeric quantifier (2→4); einige stays null", async () => {
    const { db } = await import("@/db");
    const { mealPlan } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    db.update(mealPlan)
      .set({ servingsOverride: 4 }) // recipe servings 2 → scale ×2
      .where(eq(mealPlan.id, ctx.mealPlanId))
      .run();

    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: [
          { recipeIngredientId: ctx.riIds.aepfelQuantifier },
          { recipeIngredientId: ctx.riIds.birnenEinige },
        ],
      },
    ]);

    const aepfel = listShoppingItems().find((i) => i.name === "Äpfel")!;
    expect(aepfel.sources[0].contributedQuantity).toBe(4); // 2 × (4/2)

    const birnen = listShoppingItems().find((i) => i.name === "Birnen")!;
    expect(birnen.sources[0].contributedQuantity).toBe(null); // null never scales
  });
});
