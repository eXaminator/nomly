import { and, asc, between, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  mealPlan,
  recipe,
  recipeSection,
  recipeIngredient,
  shoppingItem,
  shoppingItemSource,
  ingredient as ingredientTable,
} from "../../db/schema.ts";
import { deriveDiet, type IngredientDietaryClass, type RecipeDiet } from "../recipes/diet.ts";
import { addDays } from "./dates.ts";
import {
  defaultMealPortions,
  type MealPlanCreateInput,
  type MealPlanUpdateInput,
  type MealPlanView,
  type RecipeUsageStats,
} from "./types.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(d: string): void {
  if (!ISO_DATE.test(d)) {
    throw new Error(`invalid ISO date: ${d}`);
  }
}

function shiftDate(d: string, deltaDays: number): string {
  assertIsoDate(d);
  // Date strings are stable under UTC arithmetic — the planner doesn't care
  // about local timezone for the day-bucket.
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function nextSortOrderOnDate(tx: Tx, date: string): number {
  const row = tx
    .select({ max: sql<number | null>`MAX(${mealPlan.sortOrder})` })
    .from(mealPlan)
    .where(eq(mealPlan.date, date))
    .get();
  const max = row?.max ?? null;
  return max == null ? 0 : max + 1;
}

function prevSortOrderOnDate(tx: Tx, date: string): number {
  const row = tx
    .select({ min: sql<number | null>`MIN(${mealPlan.sortOrder})` })
    .from(mealPlan)
    .where(eq(mealPlan.date, date))
    .get();
  const min = row?.min ?? null;
  return min == null ? 0 : min - 1;
}

export function createMeal(input: MealPlanCreateInput): number {
  assertIsoDate(input.date);
  return db.transaction((tx) => {
    const base = tx
      .select({ servings: recipe.servings })
      .from(recipe)
      .where(eq(recipe.id, input.recipeId))
      .get();
    if (!base) throw new Error(`recipe ${input.recipeId} not found`);
    const sortOrder = nextSortOrderOnDate(tx, input.date);
    const inserted = tx
      .insert(mealPlan)
      .values({
        recipeId: input.recipeId,
        date: input.date,
        // Explicit override wins; otherwise bump the recipe default to a
        // sensible household baseline via `defaultMealPortions`.
        servingsOverride:
          input.servingsOverride ?? defaultMealPortions(base.servings),
        note: input.note ?? null,
        sortOrder,
      })
      .returning({ id: mealPlan.id })
      .all();
    return inserted[0].id;
  });
}

export function updateMeal(id: number, patch: MealPlanUpdateInput): void {
  const patchData: Partial<typeof mealPlan.$inferInsert> = {};
  if (Object.prototype.hasOwnProperty.call(patch, "servingsOverride")) {
    patchData.servingsOverride = patch.servingsOverride ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "note")) {
    patchData.note = patch.note ?? null;
  }
  if (Object.keys(patchData).length === 0) return;

  db.transaction((tx) => {
    // When the effective servings change, recompute each source's
    // contributed quantity from the recipe's original `recipe_ingredient`
    // value × new_scale. This intentionally discards any prior manual
    // edit on the source — the planner is the source of truth for what a
    // meal contributes; if the user edited the amount in the shopping
    // list, the planner's portion change is treated as a reset back to
    // the recipe-derived value.
    if (Object.prototype.hasOwnProperty.call(patch, "servingsOverride")) {
      const current = tx
        .select({
          recipeId: mealPlan.recipeId,
          oldOverride: mealPlan.servingsOverride,
        })
        .from(mealPlan)
        .where(eq(mealPlan.id, id))
        .get();
      if (current) {
        const recipeRow = tx
          .select({ servings: recipe.servings })
          .from(recipe)
          .where(eq(recipe.id, current.recipeId))
          .get();
        const recipeServings = recipeRow?.servings ?? 1;
        const oldEffective = current.oldOverride ?? recipeServings;
        const newEffective = patch.servingsOverride ?? recipeServings;
        if (recipeServings > 0 && newEffective !== oldEffective) {
          const newScale = newEffective / recipeServings;
          // Recompute every source row from the recipe ingredient. Source
          // rows whose recipe_ingredient.quantity is null stay null
          // (open-ended).
          const sources = tx
            .select({
              id: shoppingItemSource.id,
              itemId: shoppingItemSource.itemId,
              recipeQty: recipeIngredient.quantity,
              fixedAmount: recipeIngredient.fixedAmount,
            })
            .from(shoppingItemSource)
            .innerJoin(
              recipeIngredient,
              eq(recipeIngredient.id, shoppingItemSource.recipeIngredientId),
            )
            .where(eq(shoppingItemSource.mealPlanId, id))
            .all();
          for (const s of sources) {
            // Fixed-amount lines (no portion scaling) keep the recipe's value
            // verbatim — a "1 Prise Salz" contribution doesn't double when
            // the meal grows from 2 to 4 portions.
            const effectiveScale = s.fixedAmount ? 1 : newScale;
            const nextQty =
              s.recipeQty == null
                ? null
                : Math.round(s.recipeQty * effectiveScale * 1000) / 1000;
            tx.update(shoppingItemSource)
              .set({ contributedQuantity: nextQty })
              .where(eq(shoppingItemSource.id, s.id))
              .run();
          }
          const itemIds = Array.from(new Set(sources.map((s) => s.itemId)));
          if (itemIds.length > 0) {
            tx.update(shoppingItem)
              .set({
                version: sql`${shoppingItem.version} + 1`,
                updatedAt: sql`unixepoch()`,
              })
              .where(inArray(shoppingItem.id, itemIds))
              .run();
          }
        }
      }
    }

    tx.update(mealPlan).set(patchData).where(eq(mealPlan.id, id)).run();
  });
}

/**
 * Plain delete — Epic 4 owns this. Epic 5 will wrap the planner's delete
 * confirm to subtract shopping contributions before calling here; that flow
 * lives in §4.3.3 of the design doc, not in this service.
 */
export function deleteMeal(id: number): void {
  db.delete(mealPlan).where(eq(mealPlan.id, id)).run();
}

/**
 * ↑ button: within-day swap with the meal above, or cross-day move to the
 * bottom of the previous calendar day (not bounded by the visible page).
 */
export function reorderUp(id: number): void {
  db.transaction((tx) => {
    const m = tx.select().from(mealPlan).where(eq(mealPlan.id, id)).get();
    if (!m) return;
    const above = tx
      .select()
      .from(mealPlan)
      .where(and(eq(mealPlan.date, m.date), lt(mealPlan.sortOrder, m.sortOrder)))
      .orderBy(desc(mealPlan.sortOrder))
      .limit(1)
      .get();
    if (above) {
      // Within-day swap. Use a temp value to avoid the unique-ish collision
      // some SQLite indexes would dislike; we don't have a unique constraint
      // on (date, sort_order), but staying explicit keeps the swap obvious.
      tx.update(mealPlan)
        .set({ sortOrder: -1 - m.id })
        .where(eq(mealPlan.id, m.id))
        .run();
      tx.update(mealPlan)
        .set({ sortOrder: m.sortOrder })
        .where(eq(mealPlan.id, above.id))
        .run();
      tx.update(mealPlan)
        .set({ sortOrder: above.sortOrder })
        .where(eq(mealPlan.id, m.id))
        .run();
      return;
    }
    const prevDate = shiftDate(m.date, -1);
    const newSort = nextSortOrderOnDate(tx, prevDate);
    tx.update(mealPlan)
      .set({ date: prevDate, sortOrder: newSort })
      .where(eq(mealPlan.id, m.id))
      .run();
  });
}

/**
 * ↓ button: within-day swap with the meal below, or cross-day move to the top
 * of the next calendar day (not bounded by the visible page).
 */
export function reorderDown(id: number): void {
  db.transaction((tx) => {
    const m = tx.select().from(mealPlan).where(eq(mealPlan.id, id)).get();
    if (!m) return;
    const below = tx
      .select()
      .from(mealPlan)
      .where(and(eq(mealPlan.date, m.date), gt(mealPlan.sortOrder, m.sortOrder)))
      .orderBy(asc(mealPlan.sortOrder))
      .limit(1)
      .get();
    if (below) {
      tx.update(mealPlan)
        .set({ sortOrder: -1 - m.id })
        .where(eq(mealPlan.id, m.id))
        .run();
      tx.update(mealPlan)
        .set({ sortOrder: m.sortOrder })
        .where(eq(mealPlan.id, below.id))
        .run();
      tx.update(mealPlan)
        .set({ sortOrder: below.sortOrder })
        .where(eq(mealPlan.id, m.id))
        .run();
      return;
    }
    const nextDate = shiftDate(m.date, 1);
    const newSort = prevSortOrderOnDate(tx, nextDate);
    tx.update(mealPlan)
      .set({ date: nextDate, sortOrder: newSort })
      .where(eq(mealPlan.id, m.id))
      .run();
  });
}

/**
 * DnD drop on a day's meals column: append the meal at the end of the target
 * date. If the target date matches the meal's current date, this is a no-op
 * (callers wanting in-day reordering use `reorderDay`).
 */
export function moveMealToDay(id: number, targetDate: string): void {
  assertIsoDate(targetDate);
  db.transaction((tx) => {
    const m = tx.select().from(mealPlan).where(eq(mealPlan.id, id)).get();
    if (!m) return;
    if (m.date === targetDate) return;
    const newSort = nextSortOrderOnDate(tx, targetDate);
    tx.update(mealPlan)
      .set({ date: targetDate, sortOrder: newSort })
      .where(eq(mealPlan.id, m.id))
      .run();
  });
}

/**
 * DnD reorder within a day. `orderedIds` is the final on-screen order — we
 * rewrite `sort_order` to match. Ignores ids that aren't on the date or
 * don't exist.
 */
export function reorderDay(date: string, orderedIds: number[]): void {
  assertIsoDate(date);
  if (orderedIds.length === 0) return;
  db.transaction((tx) => {
    const rows = tx
      .select({ id: mealPlan.id })
      .from(mealPlan)
      .where(and(eq(mealPlan.date, date), inArray(mealPlan.id, orderedIds)))
      .all();
    const validIds = new Set(rows.map((r) => r.id));
    let order = 0;
    for (const id of orderedIds) {
      if (!validIds.has(id)) continue;
      tx.update(mealPlan)
        .set({ sortOrder: order })
        .where(eq(mealPlan.id, id))
        .run();
      order += 1;
    }
  });
}

export function listByDateRange(from: string, to: string): MealPlanView[] {
  assertIsoDate(from);
  assertIsoDate(to);
  const meals = db
    .select({
      id: mealPlan.id,
      date: mealPlan.date,
      servingsOverride: mealPlan.servingsOverride,
      note: mealPlan.note,
      sortOrder: mealPlan.sortOrder,
      recipeId: recipe.id,
      recipeTitle: recipe.title,
      recipePhoto: recipe.photoPath,
      recipeServings: recipe.servings,
    })
    .from(mealPlan)
    .innerJoin(recipe, eq(recipe.id, mealPlan.recipeId))
    .where(between(mealPlan.date, from, to))
    .orderBy(asc(mealPlan.date), asc(mealPlan.sortOrder))
    .all();

  if (meals.length === 0) return [];

  const dietByRecipe = computeDietForRecipes(
    Array.from(new Set(meals.map((m) => m.recipeId))),
  );

  const shoppingHits = db
    .select({ mealPlanId: shoppingItemSource.mealPlanId })
    .from(shoppingItemSource)
    .where(inArray(shoppingItemSource.mealPlanId, meals.map((m) => m.id)))
    .groupBy(shoppingItemSource.mealPlanId)
    .all();
  const hasShopping = new Set(shoppingHits.map((r) => r.mealPlanId));

  return meals.map((m) => {
    const diet = dietByRecipe.get(m.recipeId) ?? {
      isVegan: null,
      isVegetarian: null,
      confidence: "unknown" as const,
    };
    const servings = m.servingsOverride ?? m.recipeServings;
    return {
      id: m.id,
      date: m.date,
      servings,
      servingsOverride: m.servingsOverride,
      note: m.note,
      sortOrder: m.sortOrder,
      hasShoppingImpact: hasShopping.has(m.id),
      recipe: {
        id: m.recipeId,
        title: m.recipeTitle,
        photoPath: m.recipePhoto,
        baseServings: m.recipeServings,
        isVegan: diet.isVegan,
        isVegetarian: diet.isVegetarian,
        dietConfidence: diet.confidence,
      },
    };
  });
}

/**
 * Per-recipe stats for the planner sidebar:
 *   - last date planned (strictly before today)
 *   - next date planned (today or later)
 *   - count of plannings in the last 30 days (excluding today)
 *
 * One grouped query covers all three via conditional aggregates — the
 * recipe-list panel hits this once per render and slices the map by id.
 */
export function getRecipeUsageStats(today: string): Map<number, RecipeUsageStats> {
  assertIsoDate(today);
  const thirtyDaysAgo = addDays(today, -30);
  const rows = db
    .select({
      recipeId: mealPlan.recipeId,
      lastPlanned: sql<string | null>`MAX(CASE WHEN ${mealPlan.date} < ${today} THEN ${mealPlan.date} END)`,
      nextPlanned: sql<string | null>`MIN(CASE WHEN ${mealPlan.date} >= ${today} THEN ${mealPlan.date} END)`,
      count30d: sql<number>`COUNT(CASE WHEN ${mealPlan.date} >= ${thirtyDaysAgo} AND ${mealPlan.date} < ${today} THEN 1 END)`,
    })
    .from(mealPlan)
    .groupBy(mealPlan.recipeId)
    .all();

  const out = new Map<number, RecipeUsageStats>();
  for (const r of rows) {
    out.set(r.recipeId, {
      lastPlanned: r.lastPlanned ?? null,
      nextPlanned: r.nextPlanned ?? null,
      count30d: Number(r.count30d ?? 0),
    });
  }
  return out;
}

function computeDietForRecipes(recipeIds: number[]): Map<number, RecipeDiet> {
  if (recipeIds.length === 0) return new Map();
  const rows = db
    .select({
      recipeId: recipeSection.recipeId,
      dietaryClass: ingredientTable.dietaryClass,
    })
    .from(recipeIngredient)
    .innerJoin(recipeSection, eq(recipeSection.id, recipeIngredient.sectionId))
    .innerJoin(
      ingredientTable,
      eq(ingredientTable.id, recipeIngredient.ingredientId),
    )
    .where(
      and(
        inArray(recipeSection.recipeId, recipeIds),
        // Diet calc counts non-optional, non-alternative rows only —
        // mirrors {@link isOptionalIngredient} on the SQL side.
        eq(recipeIngredient.isOptional, false),
        isNull(recipeIngredient.alternativeForId),
      ),
    )
    .all();

  const byRecipe = new Map<number, IngredientDietaryClass[]>();
  for (const r of rows) {
    const list = byRecipe.get(r.recipeId) ?? [];
    list.push(r.dietaryClass as IngredientDietaryClass);
    byRecipe.set(r.recipeId, list);
  }
  const out = new Map<number, RecipeDiet>();
  for (const id of recipeIds) {
    out.set(id, deriveDiet(byRecipe.get(id) ?? []));
  }
  return out;
}
