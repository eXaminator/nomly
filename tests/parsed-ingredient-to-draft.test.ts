import { describe, it, expect } from "vitest";
import { parsedIngredientToDraft } from "@/components/recipes/types";

describe("parsedIngredientToDraft", () => {
  it("copies foldedIngredients through to the draft", () => {
    const draft = parsedIngredientToDraft({
      quantity: null,
      unit: null,
      unitMatch: "empty",
      rawUnit: null,
      name: "Oregano",
      ingredientId: 1,
      ingredientMatch: "existing",
      canonicalIngredientName: "Oregano",
      notes: null,
      foldedIngredients: [{ range: [10, 20], label: "Schabziger" }],
      quantityLow: null,
    });
    expect(draft.foldedIngredients).toEqual([{ range: [10, 20], label: "Schabziger" }]);
  });
});
