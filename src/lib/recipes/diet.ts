/**
 * Recipe-level diet derived from ingredient-level `dietary_class` tags.
 * `null` = unknown — at least one non-optional ingredient is untagged.
 */
export type RecipeDiet = {
  isVegan: boolean | null;
  isVegetarian: boolean | null;
};

export type IngredientDietaryClass = "vegan" | "vegetarian" | "meat" | null;

/**
 * Derive recipe-level vegan/vegetarian flags from the dietary class of each
 * *non-optional* contributing ingredient. Caller should pre-filter optional
 * rows out; this fn doesn't know about them.
 *
 *  - Any `meat`  → not vegan, not vegetarian (definitive).
 *  - Any `null`  → unknown (cannot claim either way).
 *  - Any `vegetarian` (no meat, no null) → vegetarian but not vegan.
 *  - All `vegan` (or empty) → both.
 */
export function deriveDiet(classes: IngredientDietaryClass[]): RecipeDiet {
  let hasMeat = false;
  let hasVegetarian = false;
  let hasUnknown = false;
  for (const c of classes) {
    if (c === "meat") hasMeat = true;
    else if (c === "vegetarian") hasVegetarian = true;
    else if (c === null) hasUnknown = true;
  }
  if (hasMeat) return { isVegan: false, isVegetarian: false };
  if (hasUnknown) return { isVegan: null, isVegetarian: null };
  if (hasVegetarian) return { isVegan: false, isVegetarian: true };
  return { isVegan: true, isVegetarian: true };
}
