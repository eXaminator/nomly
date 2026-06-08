import type {
  AddItemAction,
  AddItemResolved,
  AutocompleteHit,
  ShoppingItemView,
} from "@/lib/shopping/items";
import type { PreviewMeal } from "@/lib/shopping/preview";
import type { StaplePreviewGroup } from "@/lib/staples/preview";

async function jsonOrThrow(res: Response): Promise<unknown> {
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    throw new Error(`request failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function fetchItems(): Promise<{ items: ShoppingItemView[] }> {
  const res = await fetch("/api/v1/shopping", { cache: "no-store" });
  return (await jsonOrThrow(res)) as { items: ShoppingItemView[] };
}

export async function clearAll(): Promise<{ deletedCount: number }> {
  const res = await fetch("/api/v1/shopping", { method: "DELETE" });
  return (await jsonOrThrow(res)) as { deletedCount: number };
}

export async function clearListSelective(input: {
  removeAll: boolean;
  mealPlanIds: number[];
  stapleGroupIds?: number[];
}): Promise<{
  itemsDeleted?: number;
  itemsUpdated?: number;
  deletedCount?: number;
}> {
  const body = input.removeAll
    ? { removeAll: true }
    : {
        mealPlanIds: input.mealPlanIds,
        stapleGroupIds: input.stapleGroupIds ?? [],
      };
  const res = await fetch("/api/v1/shopping/clear", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await jsonOrThrow(res)) as {
    itemsDeleted?: number;
    itemsUpdated?: number;
    deletedCount?: number;
  };
}

export async function previewStaples(): Promise<StaplePreviewGroup[]> {
  const res = await fetch("/api/v1/shopping/preview-staples", { cache: "no-store" });
  const data = (await jsonOrThrow(res)) as { groups: StaplePreviewGroup[] };
  return data.groups;
}

export async function addStaplesToList(
  selection: Array<{
    stapleGroupId: number;
    items: Array<{ stapleGroupItemId: number; quantity?: number | null }>;
  }>,
): Promise<{
  itemsCreated: number;
  itemsIncremented: number;
  itemsReactivated: number;
  affectedItemIds: number[];
}> {
  const res = await fetch("/api/v1/shopping/add-staples", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selection }),
  });
  return (await jsonOrThrow(res)) as {
    itemsCreated: number;
    itemsIncremented: number;
    itemsReactivated: number;
    affectedItemIds: number[];
  };
}

export async function deleteStapleSource(
  itemId: number,
  sourceId: number,
): Promise<ShoppingItemView> {
  const res = await fetch(
    `/api/v1/shopping/items/${itemId}/staple-source/${sourceId}`,
    { method: "DELETE" },
  );
  const data = (await jsonOrThrow(res)) as { item: ShoppingItemView };
  return data.item;
}

export async function patchItem(
  id: number,
  patch: {
    checked?: boolean;
    note?: string | null;
    mutationId?: string;
    clientStampedAt?: number;
  },
): Promise<ShoppingItemView> {
  const res = await fetch(`/api/v1/shopping/items/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = (await jsonOrThrow(res)) as { item: ShoppingItemView };
  return data.item;
}

export async function setItemAmount(
  id: number,
  amount: { quantity: number | null; unitId: number | null },
): Promise<ShoppingItemView> {
  const res = await fetch(`/api/v1/shopping/items/${id}/amount`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(amount),
  });
  const data = (await jsonOrThrow(res)) as { item: ShoppingItemView };
  return data.item;
}

export async function addItemAmount(
  id: number,
  amount: { quantity: number | null; unitId: number | null },
): Promise<ShoppingItemView> {
  const res = await fetch(`/api/v1/shopping/items/${id}/amount`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(amount),
  });
  const data = (await jsonOrThrow(res)) as { item: ShoppingItemView };
  return data.item;
}

export async function setSourceQuantity(
  itemId: number,
  sourceId: number,
  quantity: number | null,
): Promise<ShoppingItemView> {
  const res = await fetch(
    `/api/v1/shopping/items/${itemId}/source/${sourceId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quantity }),
    },
  );
  const data = (await jsonOrThrow(res)) as { item: ShoppingItemView };
  return data.item;
}

export async function setManualAmountQuantity(
  itemId: number,
  amountId: number,
  quantity: number | null,
): Promise<ShoppingItemView> {
  const res = await fetch(
    `/api/v1/shopping/items/${itemId}/manual/${amountId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quantity }),
    },
  );
  const data = (await jsonOrThrow(res)) as { item: ShoppingItemView };
  return data.item;
}

export async function deleteSource(
  itemId: number,
  sourceId: number,
): Promise<ShoppingItemView> {
  const res = await fetch(
    `/api/v1/shopping/items/${itemId}/source/${sourceId}`,
    { method: "DELETE" },
  );
  const data = (await jsonOrThrow(res)) as { item: ShoppingItemView };
  return data.item;
}

export async function deleteManualAmount(
  itemId: number,
  amountId: number,
): Promise<ShoppingItemView> {
  const res = await fetch(
    `/api/v1/shopping/items/${itemId}/manual/${amountId}`,
    { method: "DELETE" },
  );
  const data = (await jsonOrThrow(res)) as { item: ShoppingItemView };
  return data.item;
}

export async function deleteItemAmount(
  id: number,
  amountId: number,
): Promise<ShoppingItemView> {
  const res = await fetch(
    `/api/v1/shopping/items/${id}/amount?amountId=${amountId}`,
    { method: "DELETE" },
  );
  const data = (await jsonOrThrow(res)) as { item: ShoppingItemView };
  return data.item;
}

/** Returns null when the stock covers the item's entire demand — the server
 *  removed the item from the list. */
export async function setItemStock(
  id: number,
  stock: { quantity: number | null; unitId: number | null },
): Promise<ShoppingItemView | null> {
  const res = await fetch(`/api/v1/shopping/items/${id}/stock`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(stock),
  });
  const data = (await jsonOrThrow(res)) as { item: ShoppingItemView | null };
  return data.item;
}

export async function clearItemStock(id: number): Promise<ShoppingItemView> {
  const res = await fetch(`/api/v1/shopping/items/${id}/stock`, {
    method: "DELETE",
  });
  const data = (await jsonOrThrow(res)) as { item: ShoppingItemView };
  return data.item;
}

export async function setStockBatch(
  entries: Array<{
    itemId: number;
    quantity: number | null;
    unitId: number | null;
    remove?: boolean;
  }>,
): Promise<ShoppingItemView[]> {
  const res = await fetch("/api/v1/shopping/stock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  const data = (await jsonOrThrow(res)) as { items: ShoppingItemView[] };
  return data.items;
}

/** Dry-run of {@link setStockBatch}: ids of items the given stock values
 *  would fully cover (removed on save). Writes nothing. */
export async function previewStockCoverage(
  entries: Array<{ itemId: number; quantity: number | null; unitId: number | null }>,
): Promise<number[]> {
  const res = await fetch("/api/v1/shopping/stock/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  const data = (await jsonOrThrow(res)) as { coveredItemIds: number[] };
  return data.coveredItemIds;
}

export async function deleteItem(id: number): Promise<void> {
  const res = await fetch(`/api/v1/shopping/items/${id}`, { method: "DELETE" });
  await jsonOrThrow(res);
}

export async function addItem(
  input:
    | { ingredientId: number; quantity?: number | null; unitId?: number | null; note?: string | null }
    | { newIngredient: { name: string; defaultCategoryId?: number | null }; quantity?: number | null; unitId?: number | null; note?: string | null }
    | { byName: string; quantity?: number | null; unitId?: number | null; note?: string | null },
): Promise<{ item: ShoppingItemView; resolved: AddItemResolved; action: AddItemAction }> {
  const res = await fetch("/api/v1/shopping/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await jsonOrThrow(res)) as {
    item: ShoppingItemView;
    resolved: AddItemResolved;
    action: AddItemAction;
  };
}

export async function autocomplete(query: string): Promise<AutocompleteHit[]> {
  const res = await fetch(
    `/api/v1/shopping/autocomplete?q=${encodeURIComponent(query)}`,
    { cache: "no-store" },
  );
  const data = (await jsonOrThrow(res)) as { hits: AutocompleteHit[] };
  return data.hits;
}

export async function previewMeals(
  start: string,
  length: number,
): Promise<PreviewMeal[]> {
  const res = await fetch("/api/v1/shopping/preview-meals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ start, length }),
  });
  const data = (await jsonOrThrow(res)) as { meals: PreviewMeal[] };
  return data.meals;
}

export async function addMealsToList(
  selection: Array<{
    mealPlanId: number;
    ingredients: Array<{ recipeIngredientId: number; quantity?: number | null }>;
  }>,
): Promise<{
  itemsCreated: number;
  itemsIncremented: number;
  itemsReactivated: number;
  affectedItemIds: number[];
}> {
  const res = await fetch("/api/v1/shopping/add-meals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selection }),
  });
  return (await jsonOrThrow(res)) as {
    itemsCreated: number;
    itemsIncremented: number;
    itemsReactivated: number;
    affectedItemIds: number[];
  };
}

/**
 * Flag one or more recipes as "needs update" (one-way). Used from the
 * shopping-list item menu when the user notices a recipe needs a fix while
 * shopping. Issues one PATCH per recipe against the existing endpoint.
 */
export async function markRecipesNeedUpdate(recipeIds: number[]): Promise<void> {
  await Promise.all(
    recipeIds.map(async (id) => {
      const res = await fetch(`/api/v1/recipes/${id}/needs-update`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ needsUpdate: true }),
      });
      await jsonOrThrow(res);
    }),
  );
}

export async function setUnavailable(
  kind: "ingredient",
  id: number,
  supermarketId: number,
  unavailable: boolean,
): Promise<void> {
  if (unavailable) {
    const res = await fetch("/api/v1/shopping/unavailable", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, id, supermarketId }),
    });
    await jsonOrThrow(res);
    return;
  }
  const res = await fetch(
    `/api/v1/shopping/unavailable?kind=${kind}&id=${id}&supermarketId=${supermarketId}`,
    { method: "DELETE" },
  );
  await jsonOrThrow(res);
}
