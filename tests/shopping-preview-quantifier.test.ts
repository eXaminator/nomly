/**
 * The add-meals PREVIEW must surface the effective quantifier value as `qty`,
 * exactly like `merge.ts` does for the snapshot contribution. Before the fix,
 * a quantifier-backed row (`quantity = NULL`, `quantifier_id → zwei(value 2)`)
 * appeared with `qty = null` in the preview, making the editable quantity field
 * blank even though the shopping contribution would be 2.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-preview-quantifier-"));
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
    aepfelZwei: number; // "zwei" (value 2) Äpfel — quantifier-backed
    birnenEinige: number; // "einige" (value null) Birnen — unspecified quantifier
    birnenNull: number; // bare null-quantity Birnen — baseline
  };
  ingredientIds: { aepfel: number; birnen: number };
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

  // "zwei" Äpfel: quantity null, quantifier_id → zwei (value 2)
  const aepfelZwei = db
    .insert(s.recipeIngredient)
    .values({ sectionId, ingredientId: aepfel, quantity: null, quantifierId: zweiId, unitId: null })
    .returning({ id: s.recipeIngredient.id })
    .all()[0].id;

  // "einige" Birnen: quantity null, quantifier_id → einige (value null)
  const birnenEinige = db
    .insert(s.recipeIngredient)
    .values({
      sectionId,
      ingredientId: birnen,
      quantity: null,
      quantifierId: einigeId,
      unitId: null,
    })
    .returning({ id: s.recipeIngredient.id })
    .all()[0].id;

  // Bare null-quantity Birnen: no quantifier at all (the baseline)
  const birnenNull = db
    .insert(s.recipeIngredient)
    .values({ sectionId, ingredientId: birnen, quantity: null, unitId: null })
    .returning({ id: s.recipeIngredient.id })
    .all()[0].id;

  const mealPlanId = db
    .insert(s.mealPlan)
    .values({ recipeId, date: "2026-06-14", servingsOverride: null, sortOrder: 0 })
    .returning({ id: s.mealPlan.id })
    .all()[0].id;

  return {
    mealPlanId,
    riIds: { aepfelZwei, birnenEinige, birnenNull },
    ingredientIds: { aepfel, birnen },
    quantifierIds: { zwei: zweiId, einige: einigeId },
  };
}

describe("previewMeals: effective quantifier value in the add-meals preview", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("numeric quantifier (zwei=2) appears in preview with qty 2, not null", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");

    const meals = previewMeals("2026-06-14", 1);
    expect(meals).toHaveLength(1);

    const allIngredients = meals[0].sections.flatMap((s) => s.ingredients);
    const aepfelRow = allIngredients.find((i) => i.ingredientName === "Äpfel");
    expect(aepfelRow).toBeTruthy();
    // Before the fix: qty was null (bare quantity column = NULL).
    // After the fix: qty must be 2 (COALESCE(quantity, quantifier.value)).
    expect(aepfelRow!.qty).toBe(2);
  });

  it("unspecified quantifier (einige, value null) appears in preview with qty null — same as a bare null row", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");

    const meals = previewMeals("2026-06-14", 1);
    expect(meals).toHaveLength(1);

    const allIngredients = meals[0].sections.flatMap((s) => s.ingredients);
    // Both the "einige" row and the bare-null row should resolve to null.
    const birnenRows = allIngredients.filter((i) => i.ingredientName === "Birnen");
    expect(birnenRows).toHaveLength(2);
    for (const row of birnenRows) {
      expect(row.qty).toBeNull();
    }
  });

  it("numeric quantifier scales with servings override", async () => {
    const { db } = await import("@/db");
    const { mealPlan } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    // recipe has 2 servings; override 4 → scale ×2
    db.update(mealPlan)
      .set({ servingsOverride: 4 })
      .where(eq(mealPlan.id, ctx.mealPlanId))
      .run();

    const { previewMeals } = await import("@/lib/shopping/preview");
    const meals = previewMeals("2026-06-14", 1);
    const allIngredients = meals[0].sections.flatMap((s) => s.ingredients);
    const aepfelRow = allIngredients.find((i) => i.ingredientName === "Äpfel");
    // 2 (quantifier value) × (4/2 scale) = 4
    expect(aepfelRow!.qty).toBe(4);
  });
});
