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
 * Default `servingsOverride` for a new meal entry — just the recipe's own
 * servings count. Previously this bumped 1-portion recipes to 2 to suit a
 * household of two, but the silent doubling masked itself in the shopping
 * list (e.g. "0,33 cups" recipe → "0,67 cups" on the list). Now meals
 * default to the recipe's own portion count; the user can adjust each meal
 * explicitly via the editor when they want a different size.
 */
export function defaultMealPortions(recipeServings: number): number {
  return recipeServings;
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
  /**
   * True when at least one `shopping_item_source` row currently references
   * this meal. Drives the shopping-aware delete confirm in the planner
   * (Epic 5 §4.3.3). Stays false for meals that have never been added to
   * the shopping list, or whose contributing items have all been swept or
   * deleted.
   */
  hasShoppingImpact: boolean;
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
