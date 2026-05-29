import { headers } from "next/headers";
import { ShoppingListView } from "@/components/shopping/shopping-list-view";
import { listShoppingItems } from "@/lib/shopping/items";
import {
  getSupermarketDetail,
  listSupermarkets,
} from "@/lib/stammdaten/supermarket/service";
import { nextStartWeekdayOnOrAfter, todayIso } from "@/lib/meal-plans/dates";
import { getPlannerSettings } from "@/lib/settings/planner";

export const dynamic = "force-dynamic";

export const metadata = { title: "Einkaufsliste" };

export default async function ShoppingPage() {
  const requestHeaders = await headers();
  const isShellPrecache = requestHeaders.get("x-nomly-shell") === "1";

  // The SW pre-caches /einkauf once at install with `X-Nomly-Shell: 1`.
  // That cached shell carries no items so it can never clobber IDB on an
  // offline navigation. Online navigations come through as a normal
  // request and get the full list.
  const items = isShellPrecache ? [] : listShoppingItems();
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
