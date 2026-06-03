import {
  getMostEatenRecipes,
  listByDateRange,
} from "@/lib/meal-plans/service";
import { addDays, todayIso } from "@/lib/meal-plans/dates";
import { listShoppingItems } from "@/lib/shopping/items";
import { countNeededItemsPerSupermarket } from "@/lib/shopping/supermarket-availability";
import { getTodayMealShoppingStatus } from "@/lib/shopping/today-meal-shopping";
import {
  getSupermarketDetail,
  listSupermarkets,
} from "@/lib/stammdaten/supermarket/service";
import { listRecipes } from "@/lib/recipes/service";
import { TodayShoppingWarning } from "@/components/dashboard/today-shopping-warning";
import { UpcomingMealsCard } from "@/components/dashboard/upcoming-meals-card";
import { ShoppingSummaryCard } from "@/components/dashboard/shopping-summary-card";
import { TopRecipesCard } from "@/components/dashboard/top-recipes-card";
import { NeedsUpdateCard } from "@/components/dashboard/needs-update-card";

export const dynamic = "force-dynamic";

const UPCOMING_DAYS = 3;
const TOP_RECIPES_LIMIT = 5;

export default function Home() {
  const today = todayIso();
  const dates = Array.from({ length: UPCOMING_DAYS }, (_, i) =>
    addDays(today, i),
  );
  const meals = listByDateRange(dates[0], dates[dates.length - 1]);

  const todayStatus = getTodayMealShoppingStatus();

  const items = listShoppingItems();
  const openCount = items.filter((i) => !i.checked).length;
  const supermarkets = listSupermarkets()
    .map((s) => getSupermarketDetail(s.id))
    .filter((s): s is NonNullable<typeof s> => s != null)
    .map((s) => ({
      id: s.id,
      name: s.name,
      categories: s.orderedCategories.map((c) => ({ categoryId: c.categoryId })),
    }));
  const storeCounts = countNeededItemsPerSupermarket(items, supermarkets);
  const stores = supermarkets
    .map((s) => ({ id: s.id, name: s.name, count: storeCounts.get(s.id) ?? 0 }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"));

  const topRecipes = getMostEatenRecipes(today, TOP_RECIPES_LIMIT);
  const needsUpdateRecipes = listRecipes({ needsUpdate: true }).map((r) => ({
    id: r.id,
    title: r.title,
  }));

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
          Willkommen
        </h1>
        <p className="text-[var(--color-muted-fg)]">
          Dein Überblick für die nächsten Tage.
        </p>
      </div>
      <div className="mt-8 flex flex-col gap-4">
        <TodayShoppingWarning status={todayStatus} />
        <div className="grid gap-4 lg:grid-cols-2">
          <UpcomingMealsCard
            dates={dates}
            meals={meals}
            today={today}
            className="lg:row-span-2"
          />
          <ShoppingSummaryCard openCount={openCount} stores={stores} />
          <TopRecipesCard recipes={topRecipes} />
          <NeedsUpdateCard recipes={needsUpdateRecipes} />
        </div>
      </div>
    </>
  );
}
