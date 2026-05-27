import { ShoppingListView } from "@/components/shopping/shopping-list-view";
import { listShoppingItems } from "@/lib/shopping/items";
import {
  getSupermarketDetail,
  listSupermarkets,
} from "@/lib/stammdaten/supermarket/service";
import { nextStartWeekdayOnOrAfter, todayIso } from "@/lib/meal-plans/dates";
import { getPlannerSettings } from "@/lib/settings/planner";

export const dynamic = "force-dynamic";

export default async function ShoppingPage() {
  const items = listShoppingItems();
  const supermarketList = listSupermarkets();
  const supermarkets = supermarketList
    .map((s) => getSupermarketDetail(s.id))
    .filter((s): s is NonNullable<typeof s> => s != null)
    .map((s) => ({
      id: s.id,
      name: s.name,
      categories: s.orderedCategories.map((c) => ({
        categoryId: c.categoryId,
        sortOrder: c.sortOrder,
      })),
    }));
  // Default the add-meals dialog to the next planner-week boundary so a
  // fresh shopping pass covers a forward window aligned to the configured
  // start weekday. Today wins when today already is that weekday.
  const planner = getPlannerSettings();
  const today = todayIso();
  const defaultStart = nextStartWeekdayOnOrAfter(today, planner.startWeekday);
  return (
    <ShoppingListView
      initialItems={items}
      supermarkets={supermarkets}
      defaultLengthDays={planner.daysVisible}
      defaultStart={defaultStart}
    />
  );
}
