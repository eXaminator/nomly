import type { MealPlanView } from "@/lib/meal-plans/types";

export type DragData =
  | { type: "recipe"; recipeId: number }
  | { type: "meal"; mealId: number; sourceDate: string };

export type DropData =
  | { type: "day"; date: string }
  | { type: "meal"; mealId: number; date: string }
  | { type: "day-end"; date: string; lastMealId: number }
  // The recipe list doubles as a "drag a meal here to remove it" target.
  | { type: "remove" };

export type { MealPlanView };
