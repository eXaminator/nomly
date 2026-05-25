/**
 * Recipe-level diet derived from ingredient-level `dietary_class` tags.
 *
 *  - `definite`: every contributing ingredient is tagged, OR a definite
 *    meat ruling.
 *  - `probable`: some ingredients are untagged but enough are tagged to
 *    make a best-effort claim (vegan/vegetarian only — never meat).
 *  - `unknown`: nothing tagged → no claim. Badge stays hidden.
 */
export type DietConfidence = "definite" | "probable" | "unknown";

export type RecipeDiet = {
  isVegan: boolean | null;
  isVegetarian: boolean | null;
  confidence: DietConfidence;
};

export type IngredientDietaryClass = "vegan" | "vegetarian" | "meat" | null;

export function deriveDiet(classes: IngredientDietaryClass[]): RecipeDiet {
  let hasMeat = false;
  let hasVegetarian = false;
  let hasUnknown = false;
  let hasVegan = false;
  for (const c of classes) {
    if (c === "meat") hasMeat = true;
    else if (c === "vegetarian") hasVegetarian = true;
    else if (c === "vegan") hasVegan = true;
    else hasUnknown = true;
  }
  if (hasMeat) {
    return { isVegan: false, isVegetarian: false, confidence: "definite" };
  }
  if (!hasUnknown) {
    if (hasVegetarian) {
      return { isVegan: false, isVegetarian: true, confidence: "definite" };
    }
    return { isVegan: true, isVegetarian: true, confidence: "definite" };
  }
  if (!hasVegan && !hasVegetarian) {
    return { isVegan: null, isVegetarian: null, confidence: "unknown" };
  }
  if (hasVegetarian) {
    return { isVegan: false, isVegetarian: true, confidence: "probable" };
  }
  return { isVegan: true, isVegetarian: true, confidence: "probable" };
}
