import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  ingredient,
  recipeIngredient,
  shoppingItem,
  shoppingItemSource,
  unit,
} from "../../db/schema.ts";
import type { Dimension, UnitRow } from "./format.ts";
import { loadUnitsById } from "./units-db.ts";

/**
 * The shopping_item's "24 h grace" window — checked items within this window
 * are re-activated by a fresh add. Older checked items would already have been
 * cleared by the sweeper.
 */
const GRACE_WINDOW_SECONDS = 24 * 60 * 60;

export type AddMealsSelection = {
  mealPlanId: number;
  recipeIngredientIds: number[];
};

export type AddMealsResult = {
  itemsCreated: number;
  itemsIncremented: number;
  itemsReactivated: number;
  affectedItemIds: number[];
};

type RecipeIngredientRow = {
  id: number;
  ingredientId: number;
  quantity: number | null;
  unitId: number | null;
  notes: string | null;
};

type MealMeta = {
  servings: number;
  recipeServings: number;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type BucketKey = string; // `${ingredientId}:${dimension}` or `:count-null` for unitless

type ContributionLine = {
  mealPlanId: number;
  recipeIngredientId: number;
  ingredientId: number;
  unitId: number | null;
  unitDimension: Dimension | null;
  contributedQuantity: number | null;
};

/**
 * Apply the user's selection to the running list per spec §4.3.2.
 *
 * Grouping key is `(ingredient_id, unit.dimension)`. A null unit forms its
 * own bucket (`(ingredient_id, "none")`); cross-dimension lines for the same
 * ingredient remain separate items.
 *
 * Per-bucket merge rules:
 *  - Multiple known-quantity lines → sum in base units, format in the largest
 *    sensible existing unit candidate (preferring the recipe's unit's
 *    siblings so kg-vs-g stays consistent).
 *  - Open-ended lines (qty null) within a bucket collapse to one "open" line.
 *  - If both qty-bearing and open-ended lines exist in a bucket, keep the
 *    quantity (open-ended drops out — there's already a concrete amount).
 *  - For each bucket, look up an existing `shopping_item` with the same
 *    `(ingredient_id, unit.dimension)`. If found unchecked → add. If found
 *    checked within 24h grace → reactivate with the new amount only. If
 *    found checked outside grace (shouldn't happen — sweeper would've
 *    removed it) → treat as not found. If none → create.
 *  - Every contributing recipe_ingredient produces one `shopping_item_source`
 *    row, recording the scaled `contributed_quantity` and `contributed_unit_id`.
 */
export function addMealsToList(
  selection: AddMealsSelection[],
): AddMealsResult {
  if (selection.length === 0) {
    return {
      itemsCreated: 0,
      itemsIncremented: 0,
      itemsReactivated: 0,
      affectedItemIds: [],
    };
  }

  return db.transaction((tx) => applyAdd(tx, selection));
}

function applyAdd(tx: Tx, selection: AddMealsSelection[]): AddMealsResult {
  const mealMeta = loadMealMeta(
    tx,
    selection.map((s) => s.mealPlanId),
  );
  const allRecipeIngredientIds = selection.flatMap((s) => s.recipeIngredientIds);
  const recipeRows = loadRecipeIngredients(tx, allRecipeIngredientIds);
  const unitIds = uniqNonNull(
    Array.from(recipeRows.values()).map((r) => r.unitId),
  );
  const units = loadUnitsById(unitIds);

  const contributions: ContributionLine[] = [];
  for (const sel of selection) {
    const meta = mealMeta.get(sel.mealPlanId);
    if (!meta) continue;
    const scale =
      meta.recipeServings > 0 ? meta.servings / meta.recipeServings : 1;
    for (const riId of sel.recipeIngredientIds) {
      const r = recipeRows.get(riId);
      if (!r) continue;
      const u = r.unitId != null ? units.get(r.unitId) ?? null : null;
      const qty = r.quantity == null ? null : r.quantity * scale;
      contributions.push({
        mealPlanId: sel.mealPlanId,
        recipeIngredientId: r.id,
        ingredientId: r.ingredientId,
        unitId: r.unitId,
        unitDimension: u?.dimension ?? null,
        contributedQuantity: qty,
      });
    }
  }

  const buckets = new Map<BucketKey, ContributionLine[]>();
  for (const c of contributions) {
    const key = bucketKey(c.ingredientId, c.unitDimension);
    const arr = buckets.get(key) ?? [];
    arr.push(c);
    buckets.set(key, arr);
  }

  const result: AddMealsResult = {
    itemsCreated: 0,
    itemsIncremented: 0,
    itemsReactivated: 0,
    affectedItemIds: [],
  };

  const allUnitsCache = new Map<Dimension, UnitRow[]>();
  const loadDimUnits = (d: Dimension): UnitRow[] => {
    const cached = allUnitsCache.get(d);
    if (cached) return cached;
    const rows = tx
      .select({
        id: unit.id,
        name: unit.name,
        dimension: unit.dimension,
        baseUnitId: unit.baseUnitId,
        factor: unit.factor,
      })
      .from(unit)
      .where(eq(unit.dimension, d))
      .all() as UnitRow[];
    allUnitsCache.set(d, rows);
    return rows;
  };

  for (const [, lines] of buckets) {
    const first = lines[0];
    const sample = first;
    const dim = sample.unitDimension;
    const ingredientId = sample.ingredientId;
    const defaultCategoryId = lookupDefaultCategory(tx, ingredientId);

    let mergedQty: number | null;
    let mergedUnitId: number | null;
    if (dim == null) {
      mergedQty = null;
      mergedUnitId = null;
    } else {
      const dimUnits = loadDimUnits(dim);
      const result = pickMergedQuantity(lines, dimUnits);
      mergedQty = result.qty;
      mergedUnitId = result.unitId;
    }

    const existing = findExistingItem(tx, ingredientId, dim);
    let itemId: number;
    if (existing == null) {
      itemId = createItem(tx, {
        ingredientId,
        unitId: mergedUnitId,
        quantity: mergedQty,
        categoryId: defaultCategoryId,
      });
      result.itemsCreated += 1;
    } else if (
      existing.checked &&
      existing.checkedAt != null &&
      nowSeconds() - existing.checkedAt < GRACE_WINDOW_SECONDS
    ) {
      // Reactivate: replace quantity with the new amount; do NOT sum on top
      // of the previously-checked amount (the user already grabbed it).
      reactivateItem(tx, existing.id, {
        unitId: mergedUnitId,
        quantity: mergedQty,
      });
      itemId = existing.id;
      result.itemsReactivated += 1;
    } else {
      incrementItem(tx, existing, {
        addedQuantity: mergedQty,
        addedUnitId: mergedUnitId,
        dim,
      });
      itemId = existing.id;
      result.itemsIncremented += 1;
    }

    result.affectedItemIds.push(itemId);

    for (const c of lines) {
      tx.insert(shoppingItemSource)
        .values({
          itemId,
          mealPlanId: c.mealPlanId,
          recipeIngredientId: c.recipeIngredientId,
          contributedQuantity: c.contributedQuantity,
          contributedUnitId: c.unitId,
        })
        .run();
    }
  }

  return result;
}

function pickMergedQuantity(
  lines: ContributionLine[],
  dimUnits: UnitRow[],
): { qty: number | null; unitId: number | null } {
  const knownLines = lines.filter((l) => l.contributedQuantity != null);
  if (knownLines.length === 0) {
    // All open-ended → one open line for the bucket. Pick the most common
    // unit (or first non-null) for display, falling back to base unit.
    const anyUnit = lines.find((l) => l.unitId != null)?.unitId ?? null;
    return { qty: null, unitId: anyUnit };
  }

  const unitsById = new Map(dimUnits.map((u) => [u.id, u]));
  let baseTotal = 0;
  for (const l of knownLines) {
    if (l.unitId == null) continue;
    const u = unitsById.get(l.unitId);
    if (!u) continue;
    baseTotal += (l.contributedQuantity ?? 0) * u.factor;
  }

  // "Largest sensible unit" — pick the unit with the largest factor whose
  // quantity is still ≥ 1. Bias to a unit that actually appears in the
  // contributing recipes when there's a tie.
  const preferred = new Set(
    knownLines.map((l) => l.unitId).filter((id): id is number => id != null),
  );
  const sorted = [...dimUnits].sort((a, b) => {
    if (a.factor !== b.factor) return b.factor - a.factor;
    const ap = preferred.has(a.id) ? 0 : 1;
    const bp = preferred.has(b.id) ? 0 : 1;
    return ap - bp;
  });
  let chosen: UnitRow | undefined;
  for (const u of sorted) {
    const q = baseTotal / u.factor;
    if (q >= 1) {
      chosen = u;
      break;
    }
  }
  if (!chosen) chosen = sorted[sorted.length - 1];

  const qty = round3(baseTotal / chosen.factor);
  return { qty, unitId: chosen.id };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function bucketKey(ingredientId: number, dim: Dimension | null): BucketKey {
  return `${ingredientId}:${dim ?? "none"}`;
}

function uniqNonNull<T>(arr: Array<T | null>): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const x of arr) {
    if (x == null) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function loadMealMeta(tx: Tx, mealPlanIds: number[]): Map<number, MealMeta> {
  if (mealPlanIds.length === 0) return new Map();
  const rows = tx
    .select({
      id: sql<number>`meal_plan.id`,
      servingsOverride: sql<number | null>`meal_plan.servings_override`,
      recipeServings: sql<number>`recipe.servings`,
    })
    .from(sql`meal_plan`)
    .innerJoin(sql`recipe`, sql`recipe.id = meal_plan.recipe_id`)
    .where(sql`meal_plan.id IN (${sql.join(mealPlanIds, sql`, `)})`)
    .all();
  return new Map(
    rows.map((r) => [
      r.id,
      {
        servings: r.servingsOverride ?? r.recipeServings,
        recipeServings: r.recipeServings,
      },
    ]),
  );
}

function loadRecipeIngredients(
  tx: Tx,
  ids: number[],
): Map<number, RecipeIngredientRow> {
  if (ids.length === 0) return new Map();
  const rows = tx
    .select({
      id: recipeIngredient.id,
      ingredientId: recipeIngredient.ingredientId,
      quantity: recipeIngredient.quantity,
      unitId: recipeIngredient.unitId,
      notes: recipeIngredient.notes,
    })
    .from(recipeIngredient)
    .where(sql`${recipeIngredient.id} IN (${sql.join(ids, sql`, `)})`)
    .all();
  return new Map(rows.map((r) => [r.id, r]));
}

function lookupDefaultCategory(tx: Tx, ingredientId: number): number | null {
  const row = tx
    .select({ defaultCategoryId: ingredient.defaultCategoryId })
    .from(ingredient)
    .where(eq(ingredient.id, ingredientId))
    .get();
  return row?.defaultCategoryId ?? null;
}

type ExistingItem = {
  id: number;
  quantity: number | null;
  unitId: number | null;
  checked: boolean;
  checkedAt: number | null;
  version: number;
};

function findExistingItem(
  tx: Tx,
  ingredientId: number,
  dim: Dimension | null,
): ExistingItem | null {
  // Item belongs to this bucket iff the item references the same ingredient
  // AND its current unit is in the same dimension (or both are null).
  const rows = tx
    .select({
      id: shoppingItem.id,
      quantity: shoppingItem.quantity,
      unitId: shoppingItem.unitId,
      checked: shoppingItem.checked,
      checkedAt: shoppingItem.checkedAt,
      version: shoppingItem.version,
      itemDim: unit.dimension,
    })
    .from(shoppingItem)
    .leftJoin(unit, eq(unit.id, shoppingItem.unitId))
    .where(eq(shoppingItem.ingredientId, ingredientId))
    .all();
  for (const r of rows) {
    const rowDim = (r.itemDim as Dimension | null) ?? null;
    if (rowDim === dim) {
      return {
        id: r.id,
        quantity: r.quantity,
        unitId: r.unitId,
        checked: !!r.checked,
        checkedAt: r.checkedAt,
        version: r.version,
      };
    }
  }
  return null;
}

function createItem(
  tx: Tx,
  input: {
    ingredientId: number;
    unitId: number | null;
    quantity: number | null;
    categoryId: number | null;
  },
): number {
  const maxSort = tx
    .select({ max: sql<number | null>`MAX(${shoppingItem.sortOrder})` })
    .from(shoppingItem)
    .get();
  const sortOrder = (maxSort?.max ?? -1) + 1;
  const inserted = tx
    .insert(shoppingItem)
    .values({
      ingredientId: input.ingredientId,
      productId: null,
      quantity: input.quantity,
      unitId: input.unitId,
      categoryId: input.categoryId,
      checked: false,
      checkedAt: null,
      sortOrder,
      version: 1,
    })
    .returning({ id: shoppingItem.id })
    .all();
  return inserted[0].id;
}

function incrementItem(
  tx: Tx,
  existing: ExistingItem,
  add: { addedQuantity: number | null; addedUnitId: number | null; dim: Dimension | null },
): void {
  let nextQty: number | null = existing.quantity;
  let nextUnit: number | null = existing.unitId;
  if (add.addedQuantity != null && add.dim != null) {
    const unitIds = uniqNonNull([existing.unitId, add.addedUnitId]);
    const units = loadUnitsById(unitIds);
    const existingBase =
      existing.quantity != null && existing.unitId != null
        ? existing.quantity * (units.get(existing.unitId)?.factor ?? 1)
        : 0;
    const addedBase =
      add.addedUnitId != null
        ? add.addedQuantity * (units.get(add.addedUnitId)?.factor ?? 1)
        : add.addedQuantity;
    const totalBase = existingBase + addedBase;
    nextQty = round3(totalBase / (units.get(existing.unitId ?? -1)?.factor ?? 1));
    nextUnit = existing.unitId;
  } else if (add.addedQuantity != null && existing.quantity == null) {
    // Existing open-ended + new quantified → take the new quantity.
    nextQty = round3(add.addedQuantity);
    nextUnit = add.addedUnitId;
  }
  tx.update(shoppingItem)
    .set({
      quantity: nextQty,
      unitId: nextUnit,
      version: existing.version + 1,
      updatedAt: sql`unixepoch()`,
    })
    .where(eq(shoppingItem.id, existing.id))
    .run();
}

function reactivateItem(
  tx: Tx,
  itemId: number,
  patch: { unitId: number | null; quantity: number | null },
): void {
  tx.update(shoppingItem)
    .set({
      checked: false,
      checkedAt: null,
      quantity: patch.quantity,
      unitId: patch.unitId,
      version: sql`${shoppingItem.version} + 1`,
      updatedAt: sql`unixepoch()`,
    })
    .where(eq(shoppingItem.id, itemId))
    .run();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// Re-export the grace window so tests can assert against it.
export { GRACE_WINDOW_SECONDS };

// Re-export internals for tests that want to exercise edge paths without
// hitting the full transaction.
export const _internals = {
  pickMergedQuantity,
  bucketKey,
};
