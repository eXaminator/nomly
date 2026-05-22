import { AppShell } from "@/components/layout/app-shell";
import { ShoppingListView } from "@/components/shopping/shopping-list-view";
import { listShoppingItems } from "@/lib/shopping/items";
import {
  getSupermarketDetail,
  listSupermarkets,
} from "@/lib/stammdaten/supermarket/service";
import { getShoppingSettings } from "@/lib/shopping/settings";
import { todayIso } from "@/lib/meal-plans/dates";

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
  const settings = getShoppingSettings();
  const today = todayIso();
  return (
    <AppShell>
      <ShoppingListView
        initialItems={items}
        supermarkets={supermarkets}
        defaultLengthDays={settings.defaultLengthDays}
        today={today}
      />
    </AppShell>
  );
}
