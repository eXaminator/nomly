import { todayIso } from "../meal-plans/dates.ts";
import { listShoppingItems, type ShoppingItemView } from "./items.ts";
import {
  getSupermarketDetail,
  listSupermarkets,
} from "../stammdaten/supermarket/service.ts";
import { countNeededItemsPerSupermarket } from "./supermarket-availability.ts";

export type TodayMealShoppingItem = {
  name: string;
};

export type TodayMealShoppingSupermarket = {
  id: number;
  name: string;
  /** How many of this meal's unchecked items the shop carries (≥ 1). */
  carriesCount: number;
};

export type TodayMealShopping = {
  mealPlanId: number;
  recipeId: number;
  recipeTitle: string;
  uncheckedItemCount: number;
  items: TodayMealShoppingItem[];
  supermarkets: TodayMealShoppingSupermarket[];
};

export type TodayMealShoppingStatus = {
  /** Server-local calendar day this status was computed for. */
  date: string;
  needsShopping: boolean;
  /** Distinct unchecked items across today's meals (a shared item counts once). */
  totalUncheckedItems: number;
  meals: TodayMealShopping[];
};

type Carry = {
  id: number;
  name: string;
  categories: ReadonlyArray<{ categoryId: number }>;
};

function loadSupermarkets(): Carry[] {
  return listSupermarkets()
    .map((s) => getSupermarketDetail(s.id))
    .filter((s): s is NonNullable<typeof s> => s != null)
    .map((s) => ({
      id: s.id,
      name: s.name,
      categories: s.orderedCategories.map((c) => ({ categoryId: c.categoryId })),
    }));
}

/**
 * What still needs buying for *today's* meals — the data behind the Home
 * Assistant morning reminder. For each meal planned today (leftovers excluded —
 * they never seed the list), reports its still-unchecked shopping items and,
 * per supermarket, how many of those items the shop carries. Mirrors the list's
 * own visibility rules via {@link countNeededItemsPerSupermarket}.
 */
export function getTodayMealShoppingStatus(): TodayMealShoppingStatus {
  const date = todayIso();
  const supermarkets = loadSupermarkets();

  // Group today's unchecked items by the meal that put them on the list. An
  // item needed by two of today's meals lands under both.
  const byMeal = new Map<
    number,
    { recipeId: number; recipeTitle: string; items: ShoppingItemView[] }
  >();
  const distinctItemIds = new Set<number>();

  for (const item of listShoppingItems()) {
    if (item.checked) continue;
    // Only contributions still tied to a planned meal count here — a detached
    // (meal deleted) contribution keeps its snapshot date but is no longer a
    // meal the morning reminder should report.
    const todaysSources = item.sources.filter(
      (s) => s.mealDate === date && s.mealPlanId != null && s.recipeId != null,
    );
    if (todaysSources.length === 0) continue;

    distinctItemIds.add(item.id);
    // Dedupe per meal so an item contributing twice to one meal counts once.
    const seenMeals = new Set<number>();
    for (const src of todaysSources) {
      const mealPlanId = src.mealPlanId as number;
      const recipeId = src.recipeId as number;
      if (seenMeals.has(mealPlanId)) continue;
      seenMeals.add(mealPlanId);

      const meal = byMeal.get(mealPlanId);
      if (meal) {
        meal.items.push(item);
      } else {
        byMeal.set(mealPlanId, {
          recipeId,
          recipeTitle: src.recipeTitle ?? "",
          items: [item],
        });
      }
    }
  }

  const meals: TodayMealShopping[] = [...byMeal.entries()]
    .map(([mealPlanId, meal]) => {
      const counts = countNeededItemsPerSupermarket(meal.items, supermarkets);
      const shops = supermarkets
        .map((s) => ({ id: s.id, name: s.name, carriesCount: counts.get(s.id) ?? 0 }))
        .filter((s) => s.carriesCount > 0)
        .sort((a, b) => b.carriesCount - a.carriesCount || a.name.localeCompare(b.name));
      return {
        mealPlanId,
        recipeId: meal.recipeId,
        recipeTitle: meal.recipeTitle,
        uncheckedItemCount: meal.items.length,
        items: meal.items.map((i) => ({ name: i.name })),
        supermarkets: shops,
      };
    })
    .sort((a, b) => a.mealPlanId - b.mealPlanId);

  return {
    date,
    needsShopping: meals.length > 0,
    totalUncheckedItems: distinctItemIds.size,
    meals,
  };
}
