import type { ShoppingItemView } from "@/lib/shopping/items";

export type SupermarketSummary = {
  id: number;
  name: string;
  categories: Array<{ categoryId: number; sortOrder: number }>;
};

export type ShoppingGroup = {
  key: string;
  label: string;
  items: ShoppingItemView[];
};

export type GroupedShoppingItems = {
  /** Visible open items, bucketed by category and ordered for the store. */
  openGroups: ShoppingGroup[];
  /** Visible checked items, flat, most-recently-checked first. */
  checkedItems: ShoppingItemView[];
  /** Open items that pass the active store filter. */
  visibleOpen: number;
  /** Checked items that pass the active store filter. */
  visibleChecked: number;
  /** Open items hidden by the active store filter (0 when no store selected). */
  hiddenOpen: number;
  /** Checked items hidden by the active store filter (0 when no store selected). */
  hiddenChecked: number;
};

/**
 * Returns true when `item` should be hidden for the given supermarket: either
 * the user marked it unavailable there, or its category isn't carried by that
 * store. Uncategorized items always pass — the user hasn't tagged them either
 * way, so we surface them rather than risk dropping them silently.
 */
function hiddenAtStore(
  item: ShoppingItemView,
  storeId: number | null,
  allowedCategoryIds: Set<number> | null,
): boolean {
  if (storeId == null || allowedCategoryIds == null) return false;
  if (item.unavailableSupermarketIds.includes(storeId)) return true;
  return item.categoryId != null && !allowedCategoryIds.has(item.categoryId);
}

/**
 * Splits the shopping items into the open (still-to-buy) groups and the flat
 * checked list, applying the active supermarket filter uniformly to both. The
 * filter narrows the visible shopping route; the returned `hidden*` counts let
 * the caller surface "N items hidden by the store filter".
 */
export function groupShoppingItems(
  items: ShoppingItemView[],
  supermarketId: number | null,
  supermarkets: SupermarketSummary[],
): GroupedShoppingItems {
  const sm =
    supermarketId != null
      ? supermarkets.find((s) => s.id === supermarketId) ?? null
      : null;
  const orderByCategory = sm
    ? new Map(sm.categories.map((c) => [c.categoryId, c.sortOrder]))
    : null;
  const allowedCategoryIds = sm
    ? new Set(sm.categories.map((c) => c.categoryId))
    : null;

  const open: ShoppingItemView[] = [];
  const checked: ShoppingItemView[] = [];
  let hiddenOpen = 0;
  let hiddenChecked = 0;
  for (const item of items) {
    const hidden = hiddenAtStore(item, supermarketId, allowedCategoryIds);
    if (item.checked) {
      if (hidden) hiddenChecked += 1;
      else checked.push(item);
    } else {
      if (hidden) hiddenOpen += 1;
      else open.push(item);
    }
  }

  type Bucket = {
    categoryId: number | null;
    categoryName: string;
    items: ShoppingItemView[];
  };
  const buckets = new Map<number | "none", Bucket>();
  for (const item of open) {
    const key: number | "none" = item.categoryId ?? "none";
    const b = buckets.get(key) ?? {
      categoryId: item.categoryId,
      categoryName: item.categoryName ?? "Ohne Kategorie",
      items: [],
    };
    b.items.push(item);
    buckets.set(key, b);
  }
  for (const b of buckets.values()) {
    b.items.sort((a, b2) =>
      a.name.localeCompare(b2.name, "de", { sensitivity: "base" }),
    );
  }

  // Uncategorized always sinks to the bottom of the open section, regardless
  // of whether a supermarket filter is active.
  const ordered = Array.from(buckets.values()).sort((a, b) => {
    if (a.categoryId == null && b.categoryId != null) return 1;
    if (a.categoryId != null && b.categoryId == null) return -1;
    if (orderByCategory) {
      const ao =
        a.categoryId != null ? orderByCategory.get(a.categoryId) : undefined;
      const bo =
        b.categoryId != null ? orderByCategory.get(b.categoryId) : undefined;
      if (ao != null && bo != null) return ao - bo;
      if (ao != null) return -1;
      if (bo != null) return 1;
    }
    return a.categoryName.localeCompare(b.categoryName, "de", {
      sensitivity: "base",
    });
  });

  const openGroups: ShoppingGroup[] = ordered.map((b) => ({
    key: `cat-${b.categoryId ?? "none"}`,
    label: b.categoryName,
    items: b.items,
  }));

  // Sort by checkedAt desc so the most-recently-checked item is at the top;
  // items without a checkedAt (legacy or imported) fall to the bottom.
  const checkedItems = [...checked].sort((a, b) => {
    const aAt = a.checkedAt ?? 0;
    const bAt = b.checkedAt ?? 0;
    return bAt - aAt;
  });

  return {
    openGroups,
    checkedItems,
    visibleOpen: open.length,
    visibleChecked: checked.length,
    hiddenOpen,
    hiddenChecked,
  };
}
