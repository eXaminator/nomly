/**
 * Fix C: draft converters must surface the quantifier NAME in the amount field.
 *
 * Covers:
 *  - parsedIngredientToDraft: quantifier-backed import row → draft.quantity is
 *    the quantifier wording, draft.quantifierId is set.
 *  - recipeToDraft: quantifier-backed stored row → same behaviour.
 *  - Plain numeric row (no quantifier): draft.quantity is the formatted number.
 */
import { describe, it, expect } from "vitest";
import {
  parsedIngredientToDraft,
  recipeToDraft,
} from "@/components/recipes/types";
import type { ParsedIngredientResponse } from "@/components/recipes/types";
import type { RecipeView } from "@/lib/recipes/types";

// ---------------------------------------------------------------------------
// parsedIngredientToDraft
// ---------------------------------------------------------------------------

function minimalParsed(
  over: Partial<ParsedIngredientResponse> = {},
): ParsedIngredientResponse {
  return {
    quantity: null,
    quantityLow: null,
    unit: null,
    unitMatch: "empty",
    rawUnit: null,
    name: "Mehl",
    ingredientId: 1,
    ingredientMatch: "existing",
    canonicalIngredientName: "Mehl",
    notes: null,
    ...over,
  };
}

describe("parsedIngredientToDraft — quantifier wording", () => {
  it("puts the quantifier NAME in quantity and preserves quantifierId", () => {
    const draft = parsedIngredientToDraft(
      minimalParsed({ quantifierId: 7, quantifierName: "einige", quantity: null }),
    );
    expect(draft.quantity).toBe("einige");
    expect(draft.quantifierId).toBe(7);
  });

  it("also works for a numeric quantifier (name shown, not the number)", () => {
    // For a numeric quantifier the parser may set quantity=2 as a preview
    // convenience, but the draft still shows the WORD "zwei".
    const draft = parsedIngredientToDraft(
      minimalParsed({ quantifierId: 7, quantifierName: "zwei", quantity: 2 }),
    );
    expect(draft.quantity).toBe("zwei");
    expect(draft.quantifierId).toBe(7);
    // The numeric preview is captured as quantifierValue (effective number).
    expect(draft.quantifierValue).toBe(2);
  });

  it("formats a plain numeric row normally (no quantifier)", () => {
    const draft = parsedIngredientToDraft(
      minimalParsed({ quantity: 200, quantifierId: null }),
    );
    expect(draft.quantity).toBe("200");
    expect(draft.quantifierId).toBeNull();
  });

  it("carries the original unit spelling onto draft.rawUnit even for a MATCHED unit", () => {
    // Tooltip path: source said "bunch", parser matched canonical "Bund".
    // importAnnotation.rawUnit is suppressed for matched units (badge dedup),
    // but draft.rawUnit must keep "bunch" so the tooltip reads "a bunch".
    const draft = parsedIngredientToDraft(
      minimalParsed({
        unit: { id: 5, name: "Bund" },
        unitMatch: "matched",
        rawUnit: "bunch",
      }),
    );
    expect(draft.rawUnit).toBe("bunch");
    // The badge-dedup suppression on the annotation stays as-is.
    expect(draft.importAnnotation?.rawUnit).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// recipeToDraft (stored recipe → edit form)
// ---------------------------------------------------------------------------

/** Minimal RecipeView with one ingredient, allowing per-ingredient overrides. */
function minimalRecipeView(
  ingredientOverrides: Record<string, unknown> = {},
): RecipeView {
  return {
    id: 1,
    title: "Test",
    description: null,
    photoPath: null,
    sourceUrl: null,
    servings: 2,
    prepTimeMin: null,
    cookTimeMin: null,
    tags: [],
    isVegan: null,
    isVegetarian: null,
    dietConfidence: "low",
    needsUpdate: false,
    isFavorite: false,
    createdAt: 0,
    updatedAt: 0,
    sections: [
      {
        id: 9,
        title: null,
        instructions: "",
        sortOrder: 0,
        ingredients: [
          {
            id: 10,
            ingredientId: 1,
            ingredientName: "Mehl",
            canonicalIngredientName: "Mehl",
            quantity: null,
            quantityLow: null,
            quantifierId: null,
            quantifierName: null,
            quantifierValue: null,
            unitId: null,
            unitName: null,
            unitLabel: null,
            displayFraction: false,
            notes: null,
            isOptional: false,
            fixedAmount: false,
            rawLine: null,
            isEquipment: false,
            dietaryClass: null,
            sortOrder: 0,
            alternativeForId: null,
            aliases: [],
            ...ingredientOverrides,
          },
        ],
      },
    ],
  } as unknown as RecipeView;
}

describe("recipeToDraft — quantifier wording", () => {
  it("puts the quantifier NAME in quantity and preserves quantifierId", () => {
    const draft = recipeToDraft(
      minimalRecipeView({ quantifierId: 7, quantifierName: "zwei", quantity: null }),
    );
    const ing = draft.sections[0].ingredients[0];
    expect(ing.quantity).toBe("zwei");
    expect(ing.quantifierId).toBe(7);
  });

  it("formats a plain numeric row normally (no quantifier)", () => {
    const draft = recipeToDraft(minimalRecipeView({ quantity: 200, quantifierId: null }));
    const ing = draft.sections[0].ingredients[0];
    expect(ing.quantity).toBe("200");
    expect(ing.quantifierId).toBeNull();
  });

  it("shows empty string for a row with no quantity and no quantifier", () => {
    const draft = recipeToDraft(
      minimalRecipeView({ quantity: null, quantifierId: null }),
    );
    const ing = draft.sections[0].ingredients[0];
    expect(ing.quantity).toBe("");
    expect(ing.quantifierId).toBeNull();
  });
});
