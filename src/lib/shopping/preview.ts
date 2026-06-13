import { and, asc, between, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  ingredient,
  mealPlan,
  recipe,
  recipeIngredient,
  recipeSection,
  shoppingItemSource,
  unit,
} from "../../db/schema.ts";
import { addDays } from "../meal-plans/dates.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(d: string): void {
  if (!ISO_DATE.test(d)) {
    throw new Error(`invalid ISO date: ${d}`);
  }
}

export type PreviewIngredient = {
  recipeIngredientId: number;
  ingredientId: number;
  ingredientName: string;
  qty: number | null;
  unitId: number | null;
  unitName: string | null;
  notes: string | null;
  /**
   * The recipe tagged this line as optional. The dialog surfaces it with a
   * marker and starts it unchecked so the user has to opt in. Combined
   * with {@link alternativeForId} via {@link isOptionalIngredient} when
   * deciding whether to dim / unselect a row.
   */
  isOptional: boolean;
  /**
   * Non-null when this row is an alternative for another recipe_ingredient.
   * Alternatives are always treated as optional in the shopping default —
   * consumers should pass the row through {@link isOptionalIngredient}.
   */
  alternativeForId: number | null;
  /**
   * The underlying ingredient is flagged as equipment (Backpapier, Backform …).
   * These items are pulled out of their original recipe section and grouped
   * under a synthetic "Ausrüstung" section at the bottom of the meal.
   */
  isEquipment: boolean;
  /**
   * Display-only context line: an `exclude_from_shopping_list` PRIMARY that's
   * normally dropped, but kept here because a non-excluded ALTERNATIVE below it
   * IS shown — so the alternative doesn't dangle under a missing primary. The
   * dialog renders it without a checkbox; it's never selectable, never counted
   * as required, never added to the list.
   */
  readOnly?: boolean;
};

/**
 * An unassigned line (`ingredient_id` NULL, the "Nicht zugeordnet" pill) of a
 * previewed meal. These can never be added to the shopping list — the dialog
 * surfaces them read-only so whoever builds the list at least SEES that the
 * recipe has a line that won't make it onto the list.
 */
export type PreviewUnparsedLine = {
  recipeIngredientId: number;
  /** The line's only text (`display_name` is always set for unassigned rows). */
  displayName: string;
  /** Scaled like regular lines (servings override), since it's still the
   *  amount the cook will need — fixed-amount lines keep the recipe value. */
  qty: number | null;
  unitLabel: string | null;
  notes: string | null;
};

export type PreviewSection = {
  /** Recipe section id. Stable within a recipe; surfaced so the UI can use
   *  it as a React key. */
  sectionId: number;
  /** Section title from the recipe ("Für den Teig:"), or null for the
   *  default unnamed section. The dialog renders the heading only when
   *  it's non-null AND there's more than one section in the meal. */
  title: string | null;
  ingredients: PreviewIngredient[];
};

export type PreviewMeal = {
  mealPlanId: number;
  date: string;
  recipeId: number;
  recipeTitle: string;
  servings: number;
  alreadyOnList: boolean;
  /** Recipe is marked for a later update — drives the wrench toggle on the
   *  meal row so the list-maker can (un)mark it right from the dialog. */
  needsUpdate: boolean;
  sections: PreviewSection[];
  /** Read-only "Nicht übernehmbar" block rendered below the sections. */
  unparsedLines: PreviewUnparsedLine[];
};

/**
 * Build the "Mahlzeiten hinzufügen" dialog payload per spec §4.3.1.
 * - meals in [start, start + lengthDays - 1]
 * - ingredient quantities scaled by `servings_override / recipe.servings`
 * - drop ingredients flagged `exclude_from_shopping_list`
 * - drop optional ingredients (spec: "the shopping-list builder skips them")
 * - unassigned lines (`ingredient_id` NULL) are surfaced read-only via
 *   `unparsedLines` — never selectable, never added to the list
 * - drop meals that end up with zero remaining lines AND no unparsed lines
 * - alreadyOnList = true when a `shopping_item_source` row still references
 *   the meal (transitively → item still exists, since FK is ON DELETE CASCADE)
 */
export function previewMeals(start: string, lengthDays: number): PreviewMeal[] {
  assertIsoDate(start);
  if (!Number.isInteger(lengthDays) || lengthDays < 1 || lengthDays > 60) {
    throw new Error(`lengthDays out of range: ${lengthDays}`);
  }
  const end = addDays(start, lengthDays - 1);

  const meals = db
    .select({
      mealPlanId: mealPlan.id,
      date: mealPlan.date,
      servingsOverride: mealPlan.servingsOverride,
      recipeId: recipe.id,
      recipeTitle: recipe.title,
      recipeServings: recipe.servings,
      needsUpdate: recipe.needsUpdate,
    })
    .from(mealPlan)
    .innerJoin(recipe, eq(recipe.id, mealPlan.recipeId))
    // Leftover meals never reach the shopping list — they reuse what the
    // original day already shopped for. This single filter also covers the
    // ingredient-timing helpers (upcoming-uses, ingredient usage) since they
    // both source their meals from previewMeals.
    .where(and(between(mealPlan.date, start, end), eq(mealPlan.isLeftover, false)))
    .orderBy(asc(mealPlan.date), asc(mealPlan.sortOrder))
    .all();

  if (meals.length === 0) return [];

  const recipeIds = Array.from(new Set(meals.map((m) => m.recipeId)));
  const lines = db
    .select({
      recipeId: recipeSection.recipeId,
      sectionId: recipeSection.id,
      sectionTitle: recipeSection.title,
      sectionSortOrder: recipeSection.sortOrder,
      recipeIngredientId: recipeIngredient.id,
      ingredientId: recipeIngredient.ingredientId,
      ingredientName: ingredient.name,
      qty: recipeIngredient.quantity,
      unitId: recipeIngredient.unitId,
      unitName: unit.name,
      notes: recipeIngredient.notes,
      isOptional: recipeIngredient.isOptional,
      alternativeForId: recipeIngredient.alternativeForId,
      isEquipment: ingredient.isEquipment,
      fixedAmount: recipeIngredient.fixedAmount,
      excludeFromShoppingList: ingredient.excludeFromShoppingList,
    })
    .from(recipeIngredient)
    .innerJoin(recipeSection, eq(recipeSection.id, recipeIngredient.sectionId))
    .innerJoin(ingredient, eq(ingredient.id, recipeIngredient.ingredientId))
    .leftJoin(unit, eq(unit.id, recipeIngredient.unitId))
    // The inner join on `ingredient` already drops "Nicht zugeordnet" lines
    // (ingredient_id NULL); the explicit guard documents that intent.
    .where(
      and(
        inArray(recipeSection.recipeId, recipeIds),
        isNotNull(recipeIngredient.ingredientId),
      ),
    )
    .orderBy(asc(recipeSection.sortOrder), asc(recipeIngredient.sortOrder))
    .all();

  // Unassigned lines can't pass the main query (inner join on `ingredient`),
  // so they get their own lightweight fetch. They're display-only: no
  // article, no selection, no shopping contribution.
  const unparsedRows = db
    .select({
      recipeId: recipeSection.recipeId,
      recipeIngredientId: recipeIngredient.id,
      displayName: recipeIngredient.displayName,
      qty: recipeIngredient.quantity,
      // Same display rule as the recipe view: the source's verbatim unit
      // wins over the canonical unit name.
      unitLabel: sql<
        string | null
      >`coalesce(${recipeIngredient.displayUnit}, ${unit.name})`,
      notes: recipeIngredient.notes,
      fixedAmount: recipeIngredient.fixedAmount,
    })
    .from(recipeIngredient)
    .innerJoin(recipeSection, eq(recipeSection.id, recipeIngredient.sectionId))
    .leftJoin(unit, eq(unit.id, recipeIngredient.unitId))
    .where(
      and(
        inArray(recipeSection.recipeId, recipeIds),
        isNull(recipeIngredient.ingredientId),
      ),
    )
    .orderBy(asc(recipeSection.sortOrder), asc(recipeIngredient.sortOrder))
    .all();
  const unparsedByRecipe = new Map<number, typeof unparsedRows>();
  for (const l of unparsedRows) {
    const arr = unparsedByRecipe.get(l.recipeId) ?? [];
    arr.push(l);
    unparsedByRecipe.set(l.recipeId, arr);
  }

  // Primaries that still have a NON-excluded alternative referencing them —
  // their alternative will be displayed, so an excluded such primary is kept
  // read-only (instead of dropped) so the alternative isn't orphaned.
  const parentsOfShownAlternatives = new Set<number>();
  for (const l of lines) {
    if (l.alternativeForId != null && !l.excludeFromShoppingList) {
      parentsOfShownAlternatives.add(l.alternativeForId);
    }
  }
  // recipeIngredientIds to render display-only (excluded primary, kept as
  // context for a shown alternative).
  const readOnlyIds = new Set<number>();
  const linesByRecipe = new Map<number, typeof lines>();
  for (const l of lines) {
    // exclude_from_shopping_list is a stamm-level "never include" flag
    // (Wasser, Salz set by the user). Optional lines are still rendered —
    // the dialog flags them and starts them unchecked.
    if (l.excludeFromShoppingList) {
      // Keep an excluded PRIMARY read-only when a shown alternative depends on
      // it; drop everything else excluded as before.
      if (l.alternativeForId == null && parentsOfShownAlternatives.has(l.recipeIngredientId)) {
        readOnlyIds.add(l.recipeIngredientId);
      } else {
        continue;
      }
    }
    const arr = linesByRecipe.get(l.recipeId) ?? [];
    arr.push(l);
    linesByRecipe.set(l.recipeId, arr);
  }

  const mealPlanIds = meals.map((m) => m.mealPlanId);
  const sourceHits = mealPlanIds.length
    ? db
        .select({
          mealPlanId: shoppingItemSource.mealPlanId,
          count: sql<number>`COUNT(*)`,
        })
        .from(shoppingItemSource)
        .where(inArray(shoppingItemSource.mealPlanId, mealPlanIds))
        .groupBy(shoppingItemSource.mealPlanId)
        .all()
    : [];
  const alreadyOnList = new Set(
    sourceHits.filter((r) => Number(r.count) > 0).map((r) => r.mealPlanId),
  );

  const out: PreviewMeal[] = [];
  for (const m of meals) {
    const recipeLines = linesByRecipe.get(m.recipeId) ?? [];
    const unparsedRecipeLines = unparsedByRecipe.get(m.recipeId) ?? [];
    // A meal with ONLY unparsed lines still shows up — the whole point of
    // surfacing them is that the list-maker sees the recipe has lines that
    // can't be added, instead of the meal silently disappearing.
    if (recipeLines.length === 0 && unparsedRecipeLines.length === 0) continue;
    const servings = m.servingsOverride ?? m.recipeServings;
    const scale = m.recipeServings > 0 ? servings / m.recipeServings : 1;
    const unparsedLines: PreviewUnparsedLine[] = unparsedRecipeLines.map(
      (l) => ({
        recipeIngredientId: l.recipeIngredientId,
        displayName: l.displayName ?? "",
        qty: l.qty == null ? null : l.fixedAmount ? l.qty : l.qty * scale,
        unitLabel: l.unitLabel,
        notes: l.notes,
      }),
    );
    // Group ingredients by section, preserving section + ingredient order
    // (already enforced via the ORDER BY on the query). The dialog uses
    // these to render headings — when a recipe has just one unnamed
    // section, the heading is suppressed in the UI.
    const sectionsById = new Map<number, PreviewSection>();
    const sectionOrder: number[] = [];
    for (const l of recipeLines) {
      // Unassigned lines are already filtered out by the query's
      // isNotNull guard; this also narrows the type for the push below.
      if (l.ingredientId == null) continue;
      let sec = sectionsById.get(l.sectionId);
      if (!sec) {
        sec = {
          sectionId: l.sectionId,
          title: l.sectionTitle,
          ingredients: [],
        };
        sectionsById.set(l.sectionId, sec);
        sectionOrder.push(l.sectionId);
      }
      sec.ingredients.push({
        recipeIngredientId: l.recipeIngredientId,
        ingredientId: l.ingredientId,
        ingredientName: l.ingredientName,
        // Fixed-amount lines (e.g. "1 Prise Salz") keep the recipe's value
        // regardless of how the meal's portion override compares.
        qty: l.qty == null ? null : l.fixedAmount ? l.qty : l.qty * scale,
        unitId: l.unitId,
        unitName: l.unitName,
        notes: l.notes,
        isOptional: !!l.isOptional,
        alternativeForId: l.alternativeForId,
        isEquipment: !!l.isEquipment,
        readOnly: readOnlyIds.has(l.recipeIngredientId) || undefined,
      });
    }
    // Peel equipment items out of their original sections and collect them
    // into a single synthetic "Ausrüstung" section appended at the end.
    // The shopping mental model is "all the gear in one place" — splitting
    // it across the recipe's cooking sections (where it may appear next to
    // unrelated dough or sauce ingredients) buries the equipment.
    const equipmentLines: PreviewIngredient[] = [];
    for (const id of sectionOrder) {
      const sec = sectionsById.get(id)!;
      const keep: PreviewIngredient[] = [];
      for (const ing of sec.ingredients) {
        if (ing.isEquipment) equipmentLines.push(ing);
        else keep.push(ing);
      }
      sec.ingredients = keep;
    }
    const sections = sectionOrder
      .map((id) => sectionsById.get(id)!)
      .filter((s) => s.ingredients.length > 0);
    if (equipmentLines.length > 0) {
      // Negative sentinel id — real recipe_section ids are positive
      // auto-increment values, so this can't collide and gives the React
      // key a stable per-meal value.
      sections.push({
        sectionId: -1,
        title: "Ausrüstung",
        ingredients: equipmentLines,
      });
    }
    if (sections.length === 0 && unparsedLines.length === 0) continue;
    out.push({
      mealPlanId: m.mealPlanId,
      date: m.date,
      recipeId: m.recipeId,
      recipeTitle: m.recipeTitle,
      servings,
      alreadyOnList: alreadyOnList.has(m.mealPlanId),
      needsUpdate: !!m.needsUpdate,
      sections,
      unparsedLines,
    });
  }

  return out;
}

export function isSourceLinkedToMeal(mealPlanId: number): boolean {
  const row = db
    .select({ id: shoppingItemSource.id })
    .from(shoppingItemSource)
    .where(eq(shoppingItemSource.mealPlanId, mealPlanId))
    .limit(1)
    .get();
  return row != null;
}

export function _internal_assertIsoDate(d: string): void {
  assertIsoDate(d);
}
