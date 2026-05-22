import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  category,
  ingredient,
  ingredientAlias,
  mealPlan,
  product,
  productAlias,
  recipe,
  shoppingItem,
  shoppingItemSource,
  unit,
} from "../../db/schema.ts";
import { createProductFromName, resolveByName, type NameCandidate } from "./byName.ts";

export type ShoppingItemSource = {
  mealPlanId: number;
  mealDate: string;
  recipeId: number;
  recipeTitle: string;
  contributedQuantity: number | null;
  contributedUnit: string | null;
};

export type ShoppingItemView = {
  id: number;
  refType: "ingredient" | "product";
  refId: number;
  name: string;
  quantity: number | null;
  unitId: number | null;
  unitName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  checked: boolean;
  checkedAt: number | null;
  note: string | null;
  sortOrder: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  sources: ShoppingItemSource[];
};

export function listShoppingItems(): ShoppingItemView[] {
  const ingredientRows = db
    .select({
      id: shoppingItem.id,
      refId: shoppingItem.ingredientId,
      name: ingredient.name,
      quantity: shoppingItem.quantity,
      unitId: shoppingItem.unitId,
      unitName: unit.name,
      categoryId: shoppingItem.categoryId,
      categoryName: category.name,
      checked: shoppingItem.checked,
      checkedAt: shoppingItem.checkedAt,
      note: shoppingItem.note,
      sortOrder: shoppingItem.sortOrder,
      version: shoppingItem.version,
      createdAt: shoppingItem.createdAt,
      updatedAt: shoppingItem.updatedAt,
    })
    .from(shoppingItem)
    .innerJoin(ingredient, eq(ingredient.id, shoppingItem.ingredientId))
    .leftJoin(unit, eq(unit.id, shoppingItem.unitId))
    .leftJoin(category, eq(category.id, shoppingItem.categoryId))
    .all();

  const productRows = db
    .select({
      id: shoppingItem.id,
      refId: shoppingItem.productId,
      name: product.name,
      quantity: shoppingItem.quantity,
      unitId: shoppingItem.unitId,
      unitName: unit.name,
      categoryId: shoppingItem.categoryId,
      categoryName: category.name,
      checked: shoppingItem.checked,
      checkedAt: shoppingItem.checkedAt,
      note: shoppingItem.note,
      sortOrder: shoppingItem.sortOrder,
      version: shoppingItem.version,
      createdAt: shoppingItem.createdAt,
      updatedAt: shoppingItem.updatedAt,
    })
    .from(shoppingItem)
    .innerJoin(product, eq(product.id, shoppingItem.productId))
    .leftJoin(unit, eq(unit.id, shoppingItem.unitId))
    .leftJoin(category, eq(category.id, shoppingItem.categoryId))
    .all();

  const all: ShoppingItemView[] = [
    ...ingredientRows.map((r) => ({
      id: r.id,
      refType: "ingredient" as const,
      refId: r.refId as number,
      name: r.name,
      quantity: r.quantity,
      unitId: r.unitId,
      unitName: r.unitName,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      checked: !!r.checked,
      checkedAt: r.checkedAt,
      note: r.note,
      sortOrder: r.sortOrder,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      sources: [],
    })),
    ...productRows.map((r) => ({
      id: r.id,
      refType: "product" as const,
      refId: r.refId as number,
      name: r.name,
      quantity: r.quantity,
      unitId: r.unitId,
      unitName: r.unitName,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      checked: !!r.checked,
      checkedAt: r.checkedAt,
      note: r.note,
      sortOrder: r.sortOrder,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      sources: [],
    })),
  ];

  // Attach meal-source chips per item.
  const itemIds = all.map((i) => i.id);
  const sourcesByItem = new Map<number, ShoppingItemSource[]>();
  if (itemIds.length > 0) {
    const sources = db
      .select({
        itemId: shoppingItemSource.itemId,
        mealPlanId: mealPlan.id,
        mealDate: mealPlan.date,
        recipeId: recipe.id,
        recipeTitle: recipe.title,
        contributedQuantity: shoppingItemSource.contributedQuantity,
        contributedUnit: unit.name,
      })
      .from(shoppingItemSource)
      .innerJoin(mealPlan, eq(mealPlan.id, shoppingItemSource.mealPlanId))
      .innerJoin(recipe, eq(recipe.id, mealPlan.recipeId))
      .leftJoin(unit, eq(unit.id, shoppingItemSource.contributedUnitId))
      .where(inArray(shoppingItemSource.itemId, itemIds))
      .orderBy(asc(mealPlan.date), asc(recipe.title))
      .all();
    for (const s of sources) {
      const arr = sourcesByItem.get(s.itemId) ?? [];
      arr.push({
        mealPlanId: s.mealPlanId,
        mealDate: s.mealDate,
        recipeId: s.recipeId,
        recipeTitle: s.recipeTitle,
        contributedQuantity: s.contributedQuantity,
        contributedUnit: s.contributedUnit,
      });
      sourcesByItem.set(s.itemId, arr);
    }
  }
  for (const item of all) {
    item.sources = sourcesByItem.get(item.id) ?? [];
  }

  all.sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name, "de", { sensitivity: "base" }),
  );
  return all;
}

export type AddItemInput =
  | { ingredientId: number; quantity?: number | null; unitId?: number | null; note?: string | null }
  | { productId: number; quantity?: number | null; unitId?: number | null; note?: string | null }
  | {
      newProduct: { name: string; defaultCategoryId?: number | null };
      quantity?: number | null;
      unitId?: number | null;
      note?: string | null;
    }
  | { byName: string; quantity?: number | null; unitId?: number | null; note?: string | null };

export type AddItemResolved = {
  mode: "ingredient" | "product" | "createdProduct";
  refId: number;
  displayName: string;
};

export type AddItemAction = "created" | "incremented" | "reactivated";

export class ShoppingApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

const GRACE_SECONDS = 24 * 60 * 60;

/**
 * Adds a single item to the list. Mirrors the merge-on-add behaviour for
 * ingredients (same `(ingredient_id, dimension)` bucket merges with an
 * existing unchecked item; checked-in-grace reactivates). Products always
 * create a new row — duplicates are intentionally allowed for raw products.
 */
export function addManualItem(input: AddItemInput): {
  item: ShoppingItemView;
  resolved: AddItemResolved;
  action: AddItemAction;
} {
  if ("byName" in input) {
    return addByName(input);
  }
  if ("ingredientId" in input) {
    return addIngredientItem(input.ingredientId, input);
  }
  if ("productId" in input) {
    return addProductItem(input.productId, input);
  }
  // newProduct
  const created = createProductFromName(
    input.newProduct.name,
    input.newProduct.defaultCategoryId ?? null,
  );
  return finishCreatedProduct(created, input);
}

function addByName(
  input: Extract<AddItemInput, { byName: string }>,
): ReturnType<typeof addManualItem> {
  const res = resolveByName(input.byName);
  if (res.mode === "ambiguous") {
    throw new ShoppingApiError("ambiguous name", 409, {
      candidates: res.candidates.map((c) => candidateView(c)),
    });
  }
  if (res.mode === "match") {
    const { candidate } = res;
    if (candidate.kind === "ingredient") {
      return addIngredientItem(candidate.id, input);
    }
    return addProductItem(candidate.id, input);
  }
  // none → create product
  const created = createProductFromName(input.byName);
  return finishCreatedProduct(created, input);
}

function candidateView(c: NameCandidate): {
  kind: "ingredient" | "product";
  id: number;
  name: string;
  matchedAlias?: string;
} {
  return { kind: c.kind, id: c.id, name: c.name, matchedAlias: c.matchedAlias };
}

function addIngredientItem(
  ingredientId: number,
  input: { quantity?: number | null; unitId?: number | null; note?: string | null },
): ReturnType<typeof addManualItem> {
  return db.transaction((tx) => {
    const ing = tx
      .select({
        name: ingredient.name,
        defaultCategoryId: ingredient.defaultCategoryId,
      })
      .from(ingredient)
      .where(eq(ingredient.id, ingredientId))
      .get();
    if (!ing) throw new ShoppingApiError("ingredient not found", 404);

    const dim = input.unitId
      ? (tx.select({ d: unit.dimension }).from(unit).where(eq(unit.id, input.unitId)).get()?.d ?? null)
      : null;

    const existing = findExistingForIngredient(tx, ingredientId, dim);
    let itemId: number;
    let action: AddItemAction;
    if (!existing) {
      const sortOrder = nextSortOrder(tx);
      const created = tx
        .insert(shoppingItem)
        .values({
          ingredientId,
          productId: null,
          quantity: input.quantity ?? null,
          unitId: input.unitId ?? null,
          categoryId: ing.defaultCategoryId ?? null,
          note: input.note ?? null,
          sortOrder,
          version: 1,
        })
        .returning({ id: shoppingItem.id })
        .all();
      itemId = created[0].id;
      action = "created";
    } else if (
      existing.checked &&
      existing.checkedAt != null &&
      Math.floor(Date.now() / 1000) - existing.checkedAt < GRACE_SECONDS
    ) {
      tx.update(shoppingItem)
        .set({
          checked: false,
          checkedAt: null,
          quantity: input.quantity ?? null,
          unitId: input.unitId ?? null,
          note: input.note ?? existing.note,
          version: sql`${shoppingItem.version} + 1`,
          updatedAt: sql`unixepoch()`,
        })
        .where(eq(shoppingItem.id, existing.id))
        .run();
      itemId = existing.id;
      action = "reactivated";
    } else {
      // Increment, mirroring merge.ts: keep existing unit; sum in base.
      const nextQty = sumQuantities(
        existing.quantity,
        existing.unitId,
        input.quantity ?? null,
        input.unitId ?? null,
      );
      tx.update(shoppingItem)
        .set({
          quantity: nextQty.qty,
          unitId: nextQty.unitId ?? existing.unitId,
          note: input.note ?? existing.note,
          version: sql`${shoppingItem.version} + 1`,
          updatedAt: sql`unixepoch()`,
        })
        .where(eq(shoppingItem.id, existing.id))
        .run();
      itemId = existing.id;
      action = "incremented";
    }

    const view = getItemView(itemId);
    if (!view) throw new ShoppingApiError("item missing after add", 500);
    return {
      item: view,
      resolved: { mode: "ingredient", refId: ingredientId, displayName: ing.name },
      action,
    };
  });
}

function addProductItem(
  productId: number,
  input: { quantity?: number | null; unitId?: number | null; note?: string | null },
): ReturnType<typeof addManualItem> {
  return db.transaction((tx) => {
    const p = tx
      .select({
        name: product.name,
        defaultCategoryId: product.defaultCategoryId,
      })
      .from(product)
      .where(eq(product.id, productId))
      .get();
    if (!p) throw new ShoppingApiError("product not found", 404);
    const sortOrder = nextSortOrder(tx);
    const created = tx
      .insert(shoppingItem)
      .values({
        ingredientId: null,
        productId,
        quantity: input.quantity ?? null,
        unitId: input.unitId ?? null,
        categoryId: p.defaultCategoryId ?? null,
        note: input.note ?? null,
        sortOrder,
        version: 1,
      })
      .returning({ id: shoppingItem.id })
      .all();
    const view = getItemView(created[0].id);
    if (!view) throw new ShoppingApiError("item missing after add", 500);
    return {
      item: view,
      resolved: { mode: "product", refId: productId, displayName: p.name },
      action: "created" as const,
    };
  });
}

function finishCreatedProduct(
  created: { id: number; name: string },
  input: { quantity?: number | null; unitId?: number | null; note?: string | null },
): ReturnType<typeof addManualItem> {
  const result = addProductItem(created.id, input);
  return {
    ...result,
    resolved: { mode: "createdProduct", refId: created.id, displayName: created.name },
  };
}

function findExistingForIngredient(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ingredientId: number,
  dim: string | null,
): {
  id: number;
  quantity: number | null;
  unitId: number | null;
  checked: boolean;
  checkedAt: number | null;
  note: string | null;
} | null {
  const rows = tx
    .select({
      id: shoppingItem.id,
      quantity: shoppingItem.quantity,
      unitId: shoppingItem.unitId,
      checked: shoppingItem.checked,
      checkedAt: shoppingItem.checkedAt,
      note: shoppingItem.note,
      itemDim: unit.dimension,
    })
    .from(shoppingItem)
    .leftJoin(unit, eq(unit.id, shoppingItem.unitId))
    .where(eq(shoppingItem.ingredientId, ingredientId))
    .all();
  for (const r of rows) {
    const rowDim = (r.itemDim ?? null) as string | null;
    if (rowDim === dim) {
      return {
        id: r.id,
        quantity: r.quantity,
        unitId: r.unitId,
        checked: !!r.checked,
        checkedAt: r.checkedAt,
        note: r.note,
      };
    }
  }
  return null;
}

function nextSortOrder(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): number {
  const row = tx
    .select({ max: sql<number | null>`MAX(${shoppingItem.sortOrder})` })
    .from(shoppingItem)
    .get();
  return (row?.max ?? -1) + 1;
}

function sumQuantities(
  existingQty: number | null,
  existingUnitId: number | null,
  addQty: number | null,
  addUnitId: number | null,
): { qty: number | null; unitId: number | null } {
  if (addQty == null) return { qty: existingQty, unitId: existingUnitId };
  if (existingQty == null) return { qty: addQty, unitId: addUnitId };
  if (existingUnitId == null || addUnitId == null) {
    // Unitless + unitless → numeric sum.
    if (existingUnitId == null && addUnitId == null) {
      return { qty: existingQty + addQty, unitId: null };
    }
    // Mismatch: keep existing.
    return { qty: existingQty + addQty, unitId: existingUnitId ?? addUnitId };
  }
  const rows = db
    .select({ id: unit.id, factor: unit.factor })
    .from(unit)
    .where(inArray(unit.id, [existingUnitId, addUnitId]))
    .all();
  const factors = new Map(rows.map((r) => [r.id, r.factor]));
  const existingBase = existingQty * (factors.get(existingUnitId) ?? 1);
  const addBase = addQty * (factors.get(addUnitId) ?? 1);
  const total = existingBase + addBase;
  const qty = Math.round((total / (factors.get(existingUnitId) ?? 1)) * 1000) / 1000;
  return { qty, unitId: existingUnitId };
}

export type PatchInput = {
  checked?: boolean;
  quantity?: number | null;
  unitId?: number | null;
  note?: string | null;
};

export function patchItem(id: number, patch: PatchInput): ShoppingItemView {
  const existing = db
    .select({ id: shoppingItem.id, checked: shoppingItem.checked })
    .from(shoppingItem)
    .where(eq(shoppingItem.id, id))
    .get();
  if (!existing) throw new ShoppingApiError("item not found", 404);

  const set: Partial<typeof shoppingItem.$inferInsert> = {};
  if (Object.prototype.hasOwnProperty.call(patch, "checked")) {
    set.checked = patch.checked;
    set.checkedAt = patch.checked ? Math.floor(Date.now() / 1000) : null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "quantity")) {
    set.quantity = patch.quantity ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "unitId")) {
    set.unitId = patch.unitId ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "note")) {
    set.note = patch.note ?? null;
  }
  if (Object.keys(set).length === 0) {
    const v = getItemView(id);
    if (!v) throw new ShoppingApiError("item not found", 404);
    return v;
  }
  db.update(shoppingItem)
    .set({
      ...set,
      version: sql`${shoppingItem.version} + 1`,
      updatedAt: sql`unixepoch()`,
    })
    .where(eq(shoppingItem.id, id))
    .run();
  const view = getItemView(id);
  if (!view) throw new ShoppingApiError("item not found", 404);
  return view;
}

export function deleteItem(id: number): void {
  const res = db.delete(shoppingItem).where(eq(shoppingItem.id, id)).run();
  if (res.changes === 0) throw new ShoppingApiError("item not found", 404);
}

export function getItemView(id: number): ShoppingItemView | null {
  const items = listShoppingItems();
  return items.find((i) => i.id === id) ?? null;
}

/**
 * Autocomplete for the "Artikel hinzufügen" form. Returns up to 20 hits
 * across `ingredient ∪ product` ordered by relevance (exact-prefix wins,
 * then substring).
 */
export type AutocompleteHit = {
  kind: "ingredient" | "product";
  id: number;
  name: string;
  matchedAlias?: string;
};

const ESCAPE_LIKE = (s: string) => s.replace(/[%_]/g, "\\$&");

export function autocompleteItems(rawQuery: string): AutocompleteHit[] {
  const q = rawQuery.trim();
  if (q.length === 0) return [];
  const pattern = `%${ESCAPE_LIKE(q)}%`;

  const hits: AutocompleteHit[] = [];
  const seen = new Set<string>();
  const push = (h: AutocompleteHit) => {
    const key = `${h.kind}:${h.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(h);
  };

  const ing = db
    .select({ id: ingredient.id, name: ingredient.name })
    .from(ingredient)
    .where(sql`unaccent(${ingredient.name}) LIKE ${pattern}`)
    .orderBy(asc(ingredient.name))
    .limit(20)
    .all();
  for (const r of ing) push({ kind: "ingredient", id: r.id, name: r.name });

  const ingA = db
    .select({
      id: ingredient.id,
      name: ingredient.name,
      alias: ingredientAlias.name,
    })
    .from(ingredientAlias)
    .innerJoin(ingredient, eq(ingredient.id, ingredientAlias.ingredientId))
    .where(sql`unaccent(${ingredientAlias.name}) LIKE ${pattern}`)
    .orderBy(asc(ingredientAlias.name))
    .limit(20)
    .all();
  for (const r of ingA)
    push({ kind: "ingredient", id: r.id, name: r.name, matchedAlias: r.alias });

  const prd = db
    .select({ id: product.id, name: product.name })
    .from(product)
    .where(sql`unaccent(${product.name}) LIKE ${pattern}`)
    .orderBy(asc(product.name))
    .limit(20)
    .all();
  for (const r of prd) push({ kind: "product", id: r.id, name: r.name });

  const prdA = db
    .select({
      id: product.id,
      name: product.name,
      alias: productAlias.name,
    })
    .from(productAlias)
    .innerJoin(product, eq(product.id, productAlias.productId))
    .where(sql`unaccent(${productAlias.name}) LIKE ${pattern}`)
    .orderBy(asc(productAlias.name))
    .limit(20)
    .all();
  for (const r of prdA)
    push({ kind: "product", id: r.id, name: r.name, matchedAlias: r.alias });

  return hits.slice(0, 20);
}
