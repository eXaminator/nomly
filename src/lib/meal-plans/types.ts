export type MealPlanCreateInput = {
  recipeId: number;
  date: string;
  servingsOverride?: number | null;
  note?: string | null;
};

export type MealPlanUpdateInput = {
  /** When omitted, leaves the value untouched. `null` clears the override. */
  servingsOverride?: number | null;
  note?: string | null;
};

export type MealPlanMoveInput = {
  /** Target date (ISO YYYY-MM-DD). May be outside the current visible page. */
  date: string;
  /** Optional explicit sort target. When omitted, the meal is appended. */
  sortOrder?: number;
};

/** Direction for the keyboard-friendly ↑/↓ reorder buttons. */
export type ReorderDirection = "up" | "down";

/**
 * Default `servingsOverride` for a new meal entry. Most imported recipes
 * have `servings = 1` (the schema default — they never bother setting it),
 * which produces meals that feel too small for a household-of-two plan.
 * Treat anything below 2 as "unset" and fall back to 2; otherwise honour
 * the recipe's own value.
 */
export function defaultMealPortions(recipeServings: number): number {
  return recipeServings < 2 ? 2 : recipeServings;
}

export type RecipeUsageStats = {
  /** Most recent date the recipe was planned on, strictly before today. */
  lastPlanned: string | null;
  /** Earliest upcoming date (today or later) the recipe is planned on. */
  nextPlanned: string | null;
  /** Number of meal_plan rows in the 30 days before today (exclusive). */
  count30d: number;
};

export type MealPlanView = {
  id: number;
  date: string;
  servings: number;
  servingsOverride: number | null;
  note: string | null;
  sortOrder: number;
  recipe: {
    id: number;
    title: string;
    photoPath: string | null;
    /** The recipe's base servings — useful for the editor's reset action. */
    baseServings: number;
    isVegan: boolean | null;
    isVegetarian: boolean | null;
  };
};
