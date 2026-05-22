import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  ingredient,
  recipeIngredient,
  shoppingItem,
  shoppingItemSource,
} from "../../db/schema.ts";

/**
 * The shopping_item's "24 h grace" window — checked items within this window
 * are re-activated by a fresh add. Older checked items would already have been
 * cleared by the sweeper.
 */
const GRACE_WINDOW_SECONDS = 24 * 60 * 60;

export type AddMealsSelection = {
  mealPlanId: number;
  ingredients: Array<{
    recipeIngredientId: number;
    /**
     * Optional user-edited quantity for this contribution, expressed in the
     * recipe ingredient's unit. When provided, used verbatim (no further
     * scaling by servings). When undefined, the recipe's quantity × the
     * meal's serving scale is used as before.
     */
    quantity?: number | null;
  }>;
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

type ContributionLine = {
  mealPlanId: number;
  recipeIngredientId: number;
  ingredientId: number;
  unitId: number | null;
  contributedQuantity: number | null;
};

/**
 * Apply the user's selection to the running list.
 *
 * One `shopping_item` row per ingredient — *no* dimension bucketing. Each
 * contributing `recipe_ingredient` writes one `shopping_item_source` row
 * with its scaled `contributed_quantity` / `contributed_unit_id`, and the
 * aggregated display amounts are derived at read time from those sources
 * (plus the item's own manual `quantity`/`unit_id` for hand-added entries).
 *
 * Reactivate rule: when the existing item is `checked` and the check
 * happened within the 24 h grace window, the add un-checks it and clears
 * the manual quantity (the user already grabbed the previously-checked
 * amount). The fresh sources then describe what's owed now.
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
  const allRecipeIngredientIds = selection.flatMap((s) =>
    s.ingredients.map((i) => i.recipeIngredientId),
  );
  const recipeRows = loadRecipeIngredients(tx, allRecipeIngredientIds);

  const contributions: ContributionLine[] = [];
  for (const sel of selection) {
    const meta = mealMeta.get(sel.mealPlanId);
    if (!meta) continue;
    const scale =
      meta.recipeServings > 0 ? meta.servings / meta.recipeServings : 1;
    for (const sli of sel.ingredients) {
      const r = recipeRows.get(sli.recipeIngredientId);
      if (!r) continue;
      const qty =
        sli.quantity !== undefined
          ? sli.quantity
          : r.quantity == null
            ? null
            : r.quantity * scale;
      contributions.push({
        mealPlanId: sel.mealPlanId,
        recipeIngredientId: r.id,
        ingredientId: r.ingredientId,
        unitId: r.unitId,
        contributedQuantity: qty,
      });
    }
  }

  const byIngredient = new Map<number, ContributionLine[]>();
  for (const c of contributions) {
    const arr = byIngredient.get(c.ingredientId) ?? [];
    arr.push(c);
    byIngredient.set(c.ingredientId, arr);
  }

  const result: AddMealsResult = {
    itemsCreated: 0,
    itemsIncremented: 0,
    itemsReactivated: 0,
    affectedItemIds: [],
  };

  for (const [ingredientId, lines] of byIngredient) {
    const defaultCategoryId = lookupDefaultCategory(tx, ingredientId);
    const existing = findExistingItem(tx, ingredientId);
    let itemId: number;
    if (existing == null) {
      itemId = createItem(tx, {
        ingredientId,
        categoryId: defaultCategoryId,
      });
      result.itemsCreated += 1;
    } else if (
      existing.checked &&
      existing.checkedAt != null &&
      nowSeconds() - existing.checkedAt < GRACE_WINDOW_SECONDS
    ) {
      reactivateItem(tx, existing.id);
      itemId = existing.id;
      result.itemsReactivated += 1;
    } else {
      bumpVersion(tx, existing.id);
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
  checked: boolean;
  checkedAt: number | null;
};

function findExistingItem(tx: Tx, ingredientId: number): ExistingItem | null {
  const row = tx
    .select({
      id: shoppingItem.id,
      checked: shoppingItem.checked,
      checkedAt: shoppingItem.checkedAt,
    })
    .from(shoppingItem)
    .where(eq(shoppingItem.ingredientId, ingredientId))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    checked: !!row.checked,
    checkedAt: row.checkedAt,
  };
}

function createItem(
  tx: Tx,
  input: { ingredientId: number; categoryId: number | null },
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
      quantity: null,
      unitId: null,
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

function bumpVersion(tx: Tx, itemId: number): void {
  tx.update(shoppingItem)
    .set({
      version: sql`${shoppingItem.version} + 1`,
      updatedAt: sql`unixepoch()`,
    })
    .where(eq(shoppingItem.id, itemId))
    .run();
}

function reactivateItem(tx: Tx, itemId: number): void {
  // Clear the manual quantity too — the previously-checked amount is "gone"
  // from the user's perspective; fresh sources describe what's owed now.
  tx.update(shoppingItem)
    .set({
      checked: false,
      checkedAt: null,
      quantity: null,
      unitId: null,
      version: sql`${shoppingItem.version} + 1`,
      updatedAt: sql`unixepoch()`,
    })
    .where(eq(shoppingItem.id, itemId))
    .run();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export { GRACE_WINDOW_SECONDS };
