import { sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { recipeIngredient, shoppingItemSource } from "../../db/schema.ts";
import { upsertShoppingItemForIngredient } from "./itemUpsert.ts";

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
  fixedAmount: boolean;
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
      // Fixed-amount rows keep the recipe's quantity verbatim; the meal's
      // servings override does not multiply them.
      const lineScale = r.fixedAmount ? 1 : scale;
      const qty =
        sli.quantity !== undefined
          ? sli.quantity
          : r.quantity == null
            ? null
            : r.quantity * lineScale;
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
    const upsert = upsertShoppingItemForIngredient(tx, ingredientId);
    if (upsert.created) result.itemsCreated += 1;
    else if (upsert.reactivated) result.itemsReactivated += 1;
    else result.itemsIncremented += 1;

    result.affectedItemIds.push(upsert.itemId);

    for (const c of lines) {
      tx.insert(shoppingItemSource)
        .values({
          itemId: upsert.itemId,
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
      fixedAmount: recipeIngredient.fixedAmount,
    })
    .from(recipeIngredient)
    .where(sql`${recipeIngredient.id} IN (${sql.join(ids, sql`, `)})`)
    .all();
  return new Map(rows.map((r) => [r.id, r]));
}
