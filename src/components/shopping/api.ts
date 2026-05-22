import type {
  AddItemAction,
  AddItemResolved,
  AutocompleteHit,
  ShoppingItemView,
} from "@/lib/shopping/items";
import type { PreviewMeal } from "@/lib/shopping/preview";

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

export async function patchItem(
  id: number,
  patch: { checked?: boolean; quantity?: number | null; unitId?: number | null; note?: string | null },
): Promise<ShoppingItemView> {
  const res = await fetch(`/api/v1/shopping/items/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = (await jsonOrThrow(res)) as { item: ShoppingItemView };
  return data.item;
}

export async function deleteItem(id: number): Promise<void> {
  const res = await fetch(`/api/v1/shopping/items/${id}`, { method: "DELETE" });
  await jsonOrThrow(res);
}

export async function addItem(
  input:
    | { ingredientId: number; quantity?: number | null; unitId?: number | null; note?: string | null }
    | { productId: number; quantity?: number | null; unitId?: number | null; note?: string | null }
    | { newProduct: { name: string; defaultCategoryId?: number | null }; quantity?: number | null; unitId?: number | null; note?: string | null }
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
  selection: Array<{ mealPlanId: number; recipeIngredientIds: number[] }>,
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
