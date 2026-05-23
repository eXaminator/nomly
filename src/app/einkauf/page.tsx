import { AppShell } from "@/components/layout/app-shell";
import { ShoppingListView } from "@/components/shopping/shopping-list-view";
import { listShoppingItems } from "@/lib/shopping/items";
import {
  getSupermarketDetail,
  listSupermarkets,
} from "@/lib/stammdaten/supermarket/service";
import { alignToStartWeekday, todayIso } from "@/lib/meal-plans/dates";
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
  // Default the add-meals dialog's date range to whatever the meal planner
  // would currently show: window of `daysVisible` aligned to the
  // configured start weekday. Keeps the planner and the shopping list in
  // sync without a separate "default length" setting.
  const planner = getPlannerSettings();
  const today = todayIso();
  const defaultStart = alignToStartWeekday(today, planner.startWeekday);
  return (
    <AppShell>
      <ShoppingListView
        initialItems={items}
        supermarkets={supermarkets}
        defaultLengthDays={planner.daysVisible}
        defaultStart={defaultStart}
      />
    </AppShell>
  );
}
