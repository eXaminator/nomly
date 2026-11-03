import type { ShoppingItemView } from "@/lib/shopping/items";
import type { LearnedOrder } from "@/lib/shopping/learned-order";
import { isSkippedToday, localDateIso } from "@/lib/shopping/local-date";

export type SupermarketSummary = {
  id: number;
  name: string;
  categories: Array<{ categoryId: number; sortOrder: number }>;
  /** Walking order learned from past check-offs at this store, when any. */
  learnedOrder?: LearnedOrder;
};

export type ShoppingGroup = {
  key: string;
  /** Section heading; null for the single flat group of the learned order. */
  label: string | null;
  items: ShoppingItemView[];
};

/** "category": aisle groups by the store's category order (the default).
 *  "learned": one flat list in the store's learned check-off order. */
export type ShoppingSortMode = "category" | "learned";

export type GroupOptions = {
  sortMode?: ShoppingSortMode;
  /** Device-local ISO date; a skip marker only hides its item on this day. */
  today?: string;
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
  /**
   * Articles the user explicitly marked "not available here" at the active
   * store (open or checked). Subset of the hidden items — excludes the ones
   * merely hidden because the store doesn't carry their category. Drives the
   * "Nicht verfügbar" tab, whose reverse button clears the marker. Empty when
   * no store is selected.
   */
  unavailableHere: ShoppingItemView[];
  /**
   * Open items marked "gab es hier heute nicht" at the active store today
   * (and not also permanently unavailable there). Hidden from the open list;
   * listed on the "Nicht verfügbar" tab where the marker can be lifted.
   */
  skippedHere: ShoppingItemView[];
  /** True when the open list is in learned order (mode on, store selected and
   *  the store has learned data); false when it fell back to categories. */
  learnedOrderApplied: boolean;
};

/**
 * Returns true when `item` should be hidden for the given supermarket: the
 * user marked it unavailable there, it is still open and was skipped there
 * today, or its category isn't carried by that store. Uncategorized items
 * always pass — the user hasn't tagged them either way, so we surface them
 * rather than risk dropping them silently.
 */
function hiddenAtStore(
  item: ShoppingItemView,
  storeId: number | null,
  allowedCategoryIds: Set<number> | null,
  today: string,
): boolean {
  if (storeId == null || allowedCategoryIds == null) return false;
  if (item.unavailableSupermarketIds.includes(storeId)) return true;
  if (!item.checked && isSkippedToday(item, storeId, today)) return true;
  return item.categoryId != null && !allowedCategoryIds.has(item.categoryId);
}

const byName = (a: ShoppingItemView, b: ShoppingItemView) =>
  a.name.localeCompare(b.name, "de", { sensitivity: "base" });

/**
 * Sorts open items into the store's learned walking order. Key, in order of
 * preference: the article's own learned score; its category's learned score;
 * after everything learned, the category's position in the store's configured
 * order; uncategorized articles without a score last. Ties by name.
 */
function sortByLearnedOrder(
  items: ShoppingItemView[],
  store: SupermarketSummary,
  order: LearnedOrder,
): ShoppingItemView[] {
  const ingredientScore = new Map(
    order.ingredients.map((e) => [e.ingredientId, e.score]),
  );
  const categoryScore = new Map(
    order.categories.map((e) => [e.categoryId, e.score]),
  );
  const configured = [...store.categories].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const configuredRank = new Map(
    configured.map((c, i) => [c.categoryId, (i + 1) / (configured.length + 1)]),
  );
  const key = (item: ShoppingItemView): number => {
    const own = ingredientScore.get(item.refId);
    if (own != null) return own;
    if (item.categoryId != null) {
      const cat = categoryScore.get(item.categoryId);
      if (cat != null) return cat;
      const rank = configuredRank.get(item.categoryId);
      if (rank != null) return 1 + rank;
    }
    return 3;
  };
  const keyed = items.map((item) => ({ item, key: key(item) }));
  keyed.sort((a, b) => a.key - b.key || byName(a.item, b.item));
  return keyed.map((e) => e.item);
}

/**
 * Whether the item shows in the open ("still to buy") list for this store
 * filter — the same rule `groupShoppingItems` sorts by: not checked, not
 * marked unavailable or skipped today at the store, category carried there.
 */
export function isOpenAtStore(
  item: ShoppingItemView,
  supermarketId: number | null,
  supermarkets: SupermarketSummary[],
  today: string,
): boolean {
  if (item.checked) return false;
  const sm =
    supermarketId != null
      ? supermarkets.find((s) => s.id === supermarketId) ?? null
      : null;
  const allowed = sm ? new Set(sm.categories.map((c) => c.categoryId)) : null;
  return !hiddenAtStore(item, supermarketId, allowed, today);
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
  options: GroupOptions = {},
): GroupedShoppingItems {
  const today = options.today ?? localDateIso();
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
  const unavailableHere: ShoppingItemView[] = [];
  const skippedHere: ShoppingItemView[] = [];
  let hiddenOpen = 0;
  let hiddenChecked = 0;
  for (const item of items) {
    const hidden = hiddenAtStore(item, supermarketId, allowedCategoryIds, today);
    if (supermarketId != null) {
      if (item.unavailableSupermarketIds.includes(supermarketId)) {
        unavailableHere.push(item);
      } else if (!item.checked && isSkippedToday(item, supermarketId, today)) {
        skippedHere.push(item);
      }
    }
    if (item.checked) {
      if (hidden) hiddenChecked += 1;
      else checked.push(item);
    } else {
      if (hidden) hiddenOpen += 1;
      else open.push(item);
    }
  }

  // Learned order: one flat, headerless group in the store's walking order.
  // Falls back to the category groups when the store has nothing learned yet.
  const learned =
    options.sortMode === "learned" &&
    sm != null &&
    sm.learnedOrder != null &&
    (sm.learnedOrder.ingredients.length > 0 ||
      sm.learnedOrder.categories.length > 0)
      ? sm.learnedOrder
      : null;

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
    b.items.sort(byName);
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

  const openGroups: ShoppingGroup[] =
    learned && sm
      ? open.length > 0
        ? [{ key: "learned", label: null, items: sortByLearnedOrder(open, sm, learned) }]
        : []
      : ordered.map((b) => ({
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
    unavailableHere: unavailableHere.sort(byName),
    skippedHere: skippedHere.sort(byName),
    learnedOrderApplied: learned != null,
  };
}
