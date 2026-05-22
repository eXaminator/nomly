import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  category,
  ingredient,
  ingredientAlias,
  ingredientSupermarketUnavailable,
  mealPlan,
  product,
  productAlias,
  productSupermarketUnavailable,
  recipe,
  recipeIngredient,
  shoppingItem,
  shoppingItemSource,
  unit,
} from "../../db/schema.ts";
import { createProductFromName, resolveByName, type NameCandidate } from "./byName.ts";
import type { Dimension, UnitRow } from "./format.ts";
import { loadUnitsByDimension } from "./units-db.ts";

export type ShoppingItemSourceView = {
  sourceId: number;
  mealPlanId: number;
  mealDate: string;
  recipeId: number;
  recipeTitle: string;
  recipeIngredientId: number;
  contributedQuantity: number | null;
  contributedUnit: string | null;
  recipeNotes: string | null;
};

/**
 * One row in the aggregated-amounts list for an item. Same dimension
 * contributions (e.g. 500 g + 0.5 kg) are summed into a single entry;
 * cross-dimension contributions produce multiple entries.
 */
export type ShoppingItemAmount = {
  quantity: number | null;
  unitId: number | null;
  unitName: string | null;
  dimension: Dimension | null;
};

export type ShoppingItemView = {
  id: number;
  refType: "ingredient" | "product";
  refId: number;
  name: string;
  /** Aggregated amounts derived from sources + manual quantity. */
  amounts: ShoppingItemAmount[];
  /** User-set manual quantity (preserved separately so the editor can show it). */
  manualQuantity: number | null;
  manualUnitId: number | null;
  manualUnitName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  checked: boolean;
  checkedAt: number | null;
  note: string | null;
  sortOrder: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** Supermarket IDs where this ingredient/product is marked unavailable. */
  unavailableSupermarketIds: number[];
  sources: ShoppingItemSourceView[];
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

  const baseRows = [
    ...ingredientRows.map((r) => ({ ...r, refType: "ingredient" as const })),
    ...productRows.map((r) => ({ ...r, refType: "product" as const })),
  ];

  const itemIds = baseRows.map((r) => r.id);
  type RawSource = ShoppingItemSourceView & { contributedUnitId: number | null };
  const sourcesByItem = new Map<number, RawSource[]>();
  if (itemIds.length > 0) {
    const sources = db
      .select({
        sourceId: shoppingItemSource.id,
        itemId: shoppingItemSource.itemId,
        mealPlanId: mealPlan.id,
        mealDate: mealPlan.date,
        recipeId: recipe.id,
        recipeTitle: recipe.title,
        recipeIngredientId: shoppingItemSource.recipeIngredientId,
        contributedQuantity: shoppingItemSource.contributedQuantity,
        contributedUnit: unit.name,
        contributedUnitId: shoppingItemSource.contributedUnitId,
        recipeNotes: recipeIngredient.notes,
      })
      .from(shoppingItemSource)
      .innerJoin(mealPlan, eq(mealPlan.id, shoppingItemSource.mealPlanId))
      .innerJoin(recipe, eq(recipe.id, mealPlan.recipeId))
      .innerJoin(
        recipeIngredient,
        eq(recipeIngredient.id, shoppingItemSource.recipeIngredientId),
      )
      .leftJoin(unit, eq(unit.id, shoppingItemSource.contributedUnitId))
      .where(inArray(shoppingItemSource.itemId, itemIds))
      .orderBy(asc(mealPlan.date), asc(recipe.title))
      .all();
    for (const s of sources) {
      const arr = sourcesByItem.get(s.itemId) ?? [];
      arr.push({
        sourceId: s.sourceId,
        mealPlanId: s.mealPlanId,
        mealDate: s.mealDate,
        recipeId: s.recipeId,
        recipeTitle: s.recipeTitle,
        recipeIngredientId: s.recipeIngredientId,
        contributedQuantity: s.contributedQuantity,
        contributedUnit: s.contributedUnit,
        contributedUnitId: s.contributedUnitId,
        recipeNotes: s.recipeNotes,
      });
      sourcesByItem.set(s.itemId, arr);
    }
  }

  // Load unit metadata (factor/dimension) for every unit referenced by an
  // item's manual quantity or by any source contribution. One round-trip.
  const allUnitIds = new Set<number>();
  for (const r of baseRows) if (r.unitId != null) allUnitIds.add(r.unitId);
  for (const sources of sourcesByItem.values()) {
    for (const s of sources) {
      if (s.contributedUnitId != null) allUnitIds.add(s.contributedUnitId);
    }
  }
  const unitRows = allUnitIds.size === 0
    ? []
    : (db
        .select({
          id: unit.id,
          name: unit.name,
          dimension: unit.dimension,
          baseUnitId: unit.baseUnitId,
          factor: unit.factor,
        })
        .from(unit)
        .where(inArray(unit.id, Array.from(allUnitIds)))
        .all() as UnitRow[]);
  const unitsById = new Map(unitRows.map((u) => [u.id, u]));

  // Load unavailable markers separately for ingredients and products. Both
  // tables share the same shape but reference different parents.
  const ingredientIds = baseRows
    .filter((r) => r.refType === "ingredient")
    .map((r) => r.refId as number);
  const productIds = baseRows
    .filter((r) => r.refType === "product")
    .map((r) => r.refId as number);
  const ingredientUnavailable = new Map<number, number[]>();
  const productUnavailable = new Map<number, number[]>();
  if (ingredientIds.length > 0) {
    const rows = db
      .select({
        ingredientId: ingredientSupermarketUnavailable.ingredientId,
        supermarketId: ingredientSupermarketUnavailable.supermarketId,
      })
      .from(ingredientSupermarketUnavailable)
      .where(inArray(ingredientSupermarketUnavailable.ingredientId, ingredientIds))
      .all();
    for (const r of rows) {
      const arr = ingredientUnavailable.get(r.ingredientId) ?? [];
      arr.push(r.supermarketId);
      ingredientUnavailable.set(r.ingredientId, arr);
    }
  }
  if (productIds.length > 0) {
    const rows = db
      .select({
        productId: productSupermarketUnavailable.productId,
        supermarketId: productSupermarketUnavailable.supermarketId,
      })
      .from(productSupermarketUnavailable)
      .where(inArray(productSupermarketUnavailable.productId, productIds))
      .all();
    for (const r of rows) {
      const arr = productUnavailable.get(r.productId) ?? [];
      arr.push(r.supermarketId);
      productUnavailable.set(r.productId, arr);
    }
  }

  const all: ShoppingItemView[] = baseRows.map((r) => {
    const sources = sourcesByItem.get(r.id) ?? [];
    const manualUnit = r.unitId != null ? unitsById.get(r.unitId) ?? null : null;
    const amounts = buildAggregatedAmounts({
      manual: {
        quantity: r.quantity,
        unit: manualUnit,
      },
      sources: sources.map((s) => ({
        quantity: s.contributedQuantity,
        unit: s.contributedUnitId != null ? unitsById.get(s.contributedUnitId) ?? null : null,
      })),
    });
    const unavailable =
      r.refType === "ingredient"
        ? ingredientUnavailable.get(r.refId as number) ?? []
        : productUnavailable.get(r.refId as number) ?? [];
    return {
      id: r.id,
      refType: r.refType,
      refId: r.refId as number,
      name: r.name,
      amounts,
      manualQuantity: r.quantity,
      manualUnitId: r.unitId,
      manualUnitName: r.unitName,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      checked: !!r.checked,
      checkedAt: r.checkedAt,
      note: r.note,
      sortOrder: r.sortOrder,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      unavailableSupermarketIds: unavailable,
      sources: sources.map((s) => ({
        sourceId: s.sourceId,
        mealPlanId: s.mealPlanId,
        mealDate: s.mealDate,
        recipeId: s.recipeId,
        recipeTitle: s.recipeTitle,
        recipeIngredientId: s.recipeIngredientId,
        contributedQuantity: s.contributedQuantity,
        contributedUnit: s.contributedUnit,
        recipeNotes: s.recipeNotes,
      })),
    };
  });

  all.sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name, "de", { sensitivity: "base" }),
  );
  return all;
}

type AggregateInput = {
  manual: { quantity: number | null; unit: UnitRow | null };
  sources: Array<{ quantity: number | null; unit: UnitRow | null }>;
};

/**
 * Group contributions by dimension and sum in base units. A contribution
 * with no unit and no quantity is ignored (nothing to render); with no unit
 * but a quantity, it lands in a `dimension: null` "unitless" bucket. Cross-
 * dimension contributions appear as separate entries (e.g. mass + count).
 */
function buildAggregatedAmounts(input: AggregateInput): ShoppingItemAmount[] {
  type Bucket = {
    dimension: Dimension | null;
    contributions: Array<{ quantity: number | null; unit: UnitRow | null }>;
  };
  const bucketsByDim = new Map<Dimension | "unitless", Bucket>();
  const addLine = (line: { quantity: number | null; unit: UnitRow | null }) => {
    if (line.quantity == null && line.unit == null) return;
    const key: Dimension | "unitless" = line.unit?.dimension ?? "unitless";
    const dim = key === "unitless" ? null : key;
    const b = bucketsByDim.get(key) ?? { dimension: dim, contributions: [] };
    b.contributions.push(line);
    bucketsByDim.set(key, b);
  };
  addLine(input.manual);
  for (const s of input.sources) addLine(s);

  const out: ShoppingItemAmount[] = [];
  for (const b of bucketsByDim.values()) {
    if (b.dimension == null) {
      // Unitless: sum the quantities (if any), drop unit. If all are
      // open-ended, render as one open-ended row.
      let total = 0;
      let allOpen = true;
      for (const c of b.contributions) {
        if (c.quantity != null) {
          total += c.quantity;
          allOpen = false;
        }
      }
      out.push({
        quantity: allOpen ? null : round3(total),
        unitId: null,
        unitName: null,
        dimension: null,
      });
      continue;
    }
    // Mixed-unit dimension: sum in base, format in the largest sensible
    // unit that appears in the contributions (avoids inventing a "kg"
    // when only "g" was on the list).
    const dimUnits = loadDimensionUnits(b.dimension);
    let baseTotal = 0;
    let anyKnown = false;
    const usedUnits: UnitRow[] = [];
    for (const c of b.contributions) {
      if (c.unit) usedUnits.push(c.unit);
      if (c.quantity == null) continue;
      anyKnown = true;
      const factor = c.unit?.factor ?? 1;
      baseTotal += c.quantity * factor;
    }
    if (!anyKnown) {
      // All open-ended within this dimension — pick any encountered unit
      // for display.
      const u = usedUnits[0];
      out.push({
        quantity: null,
        unitId: u?.id ?? null,
        unitName: u?.name ?? null,
        dimension: b.dimension,
      });
      continue;
    }
    // Pick the largest-factor unit that still yields ≥ 1, biased toward
    // units that actually appear in the contributions.
    const preferredIds = new Set(usedUnits.map((u) => u.id));
    const candidates = dimUnits.length > 0 ? dimUnits : usedUnits;
    const sorted = [...candidates].sort((a, b2) => {
      if (a.factor !== b2.factor) return b2.factor - a.factor;
      const ap = preferredIds.has(a.id) ? 0 : 1;
      const bp = preferredIds.has(b2.id) ? 0 : 1;
      return ap - bp;
    });
    let chosen: UnitRow | undefined;
    for (const u of sorted) {
      if (baseTotal / u.factor >= 1) {
        chosen = u;
        break;
      }
    }
    if (!chosen) chosen = sorted[sorted.length - 1] ?? usedUnits[0];
    if (!chosen) {
      out.push({
        quantity: round3(baseTotal),
        unitId: null,
        unitName: null,
        dimension: b.dimension,
      });
      continue;
    }
    out.push({
      quantity: round3(baseTotal / chosen.factor),
      unitId: chosen.id,
      unitName: chosen.name,
      dimension: b.dimension,
    });
  }

  // Stable order: mass, volume, count, unitless.
  const order: Record<string, number> = { mass: 0, volume: 1, count: 2, unitless: 3 };
  out.sort((a, b) => {
    const ak = a.dimension ?? "unitless";
    const bk = b.dimension ?? "unitless";
    return (order[ak] ?? 99) - (order[bk] ?? 99);
  });
  return out;
}

const dimUnitsCache = new Map<Dimension, UnitRow[]>();
function loadDimensionUnits(d: Dimension): UnitRow[] {
  const cached = dimUnitsCache.get(d);
  if (cached) return cached;
  const rows = loadUnitsByDimension(d);
  dimUnitsCache.set(d, rows);
  return rows;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Adds a single manual item to the list. Always at most one shopping_item
 * row per ingredient — a fresh add against an existing item simply bumps
 * the version and (if the new add carries a quantity) replaces the manual
 * quantity. Checked items inside the 24 h grace window get reactivated.
 *
 * Products always create a new row — same-name product duplicates are
 * intentionally allowed since "1× Toilettenpapier" + "1× Toilettenpapier"
 * isn't meaningful to merge.
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

    const existing = findExistingForIngredient(tx, ingredientId);
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
      // Existing unchecked: only replace the manual quantity if the caller
      // sent one (otherwise just bump version — source-derived amounts
      // already cover everything else).
      const patch: Partial<typeof shoppingItem.$inferInsert> = {};
      if (input.quantity !== undefined) patch.quantity = input.quantity ?? null;
      if (input.unitId !== undefined) patch.unitId = input.unitId ?? null;
      if (input.note !== undefined) patch.note = input.note ?? null;
      tx.update(shoppingItem)
        .set({
          ...patch,
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
  tx: Tx,
  ingredientId: number,
): {
  id: number;
  quantity: number | null;
  unitId: number | null;
  checked: boolean;
  checkedAt: number | null;
  note: string | null;
} | null {
  const row = tx
    .select({
      id: shoppingItem.id,
      quantity: shoppingItem.quantity,
      unitId: shoppingItem.unitId,
      checked: shoppingItem.checked,
      checkedAt: shoppingItem.checkedAt,
      note: shoppingItem.note,
    })
    .from(shoppingItem)
    .where(eq(shoppingItem.ingredientId, ingredientId))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    quantity: row.quantity,
    unitId: row.unitId,
    checked: !!row.checked,
    checkedAt: row.checkedAt,
    note: row.note,
  };
}

function nextSortOrder(tx: Tx): number {
  const row = tx
    .select({ max: sql<number | null>`MAX(${shoppingItem.sortOrder})` })
    .from(shoppingItem)
    .get();
  return (row?.max ?? -1) + 1;
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
