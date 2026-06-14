/**
 * Fix B: the mutual-exclusivity refine on ingredientSchema must reject a row
 * that carries quantityLow alongside a quantifierId (not just quantity).
 */
import { describe, it, expect } from "vitest";
import { recipeInputSchema } from "@/lib/recipes/validate";

/** Minimal valid recipe wrapper so we can test a single ingredient row. */
function recipe(ingredientOverrides: Record<string, unknown>) {
  return {
    title: "Test",
    description: null,
    servings: 2,
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
            ingredientName: "Mehl",
            ingredientId: null,
            addAsAlias: false,
            unassigned: false,
            quantity: null,
            quantityLow: null,
            quantifierId: null,
            unitId: null,
            displayUnit: null,
            notes: null,
            isOptional: false,
            fixedAmount: false,
            rawLine: null,
            isAlternative: false,
            ...ingredientOverrides,
          },
        ],
      },
    ],
  };
}

describe("recipeInputSchema — quantifier mutual-exclusivity", () => {
  it("accepts a row with quantifierId only (quantity and quantityLow both null)", () => {
    const result = recipeInputSchema.safeParse(
      recipe({ quantity: null, quantityLow: null, quantifierId: 3 }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a row with quantity AND quantifierId (original check)", () => {
    const result = recipeInputSchema.safeParse(
      recipe({ quantity: 5, quantityLow: null, quantifierId: 3 }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("sections.0.ingredients.0.quantifierId");
    }
  });

  it("rejects a row with quantityLow AND quantifierId (new check)", () => {
    // quantity is null but quantityLow is set — low bound of a range alongside
    // a quantifier reference is equally invalid.
    const result = recipeInputSchema.safeParse(
      recipe({ quantity: null, quantityLow: 5, quantifierId: 3 }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("sections.0.ingredients.0.quantifierId");
    }
  });

  it("accepts a row with only quantityLow set and no quantifierId", () => {
    // A range (quantity=5, quantityLow=3) with no quantifier is valid.
    const result = recipeInputSchema.safeParse(
      recipe({ quantity: 5, quantityLow: 3, quantifierId: null }),
    );
    expect(result.success).toBe(true);
  });
});
