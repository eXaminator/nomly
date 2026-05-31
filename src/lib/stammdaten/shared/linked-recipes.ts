import { asc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "../../../db/index.ts";
import {
  ingredient,
  ingredientUnitConversion,
  recipe,
  recipeIngredient,
  recipeSection,
  recipeTag,
  unit,
} from "../../../db/schema.ts";

import type {
  IngredientConversionLink,
  RecipeIngredientUsage,
  RecipeLink,
} from "./types.ts";

const LIMIT_PER_ID = 50;

/**
 * Returns every distinct recipe per ingredient id (no cap — the
 * "Verwendung" UI shows the full list), joined through `recipe_section`.
 * Each link carries the per-row usage details (quantity, unit, notes, …)
 * so the UI can show *how* the ingredient is used in each recipe, not just
 * which recipes use it.
 */
export function linkedRecipesForIngredients(
  ingredientIds: number[],
): Map<number, RecipeLink[]> {
  const out = new Map<number, RecipeLink[]>();
  if (ingredientIds.length === 0) return out;
  for (const id of ingredientIds) out.set(id, []);

  // Per-recipe aggregation: each ingredient may appear multiple times in the
  // same recipe (different sections, parallel rows), and we want one list
  // entry per recipe with all its usages collected.
  const linksByOwner = new Map<number, Map<number, RecipeLink>>();
  for (const id of ingredientIds) linksByOwner.set(id, new Map());

  const rows = db
    .select({
      ownerId: recipeIngredient.ingredientId,
      recipeId: recipe.id,
      recipeTitle: recipe.title,
      quantity: recipeIngredient.quantity,
      unitName: unit.name,
      displayUnit: recipeIngredient.displayUnit,
      displayName: recipeIngredient.displayName,
      notes: recipeIngredient.notes,
      isOptional: recipeIngredient.isOptional,
      alternativeForId: recipeIngredient.alternativeForId,
      fixedAmount: recipeIngredient.fixedAmount,
    })
    .from(recipeIngredient)
    .innerJoin(
      recipeSection,
      eq(recipeSection.id, recipeIngredient.sectionId),
    )
    .innerJoin(recipe, eq(recipe.id, recipeSection.recipeId))
    .leftJoin(unit, eq(unit.id, recipeIngredient.unitId))
    .where(inArray(recipeIngredient.ingredientId, ingredientIds))
    .orderBy(asc(recipe.title))
    .all();

  for (const r of rows) {
    if (r.ownerId == null) continue;
    const byRecipe = linksByOwner.get(r.ownerId);
    const list = out.get(r.ownerId);
    if (!byRecipe || !list) continue;

    const usage: RecipeIngredientUsage = {
      quantity: r.quantity,
      unitName: r.unitName,
      displayUnit: r.displayUnit,
      displayName: r.displayName,
      notes: r.notes,
      isOptional: r.isOptional,
      alternativeForId: r.alternativeForId,
      fixedAmount: r.fixedAmount,
    };

    const existing = byRecipe.get(r.recipeId);
    if (existing) {
      existing.usages!.push(usage);
      continue;
    }
    const link: RecipeLink = {
      id: r.recipeId,
      title: r.recipeTitle,
      usages: [usage],
    };
    byRecipe.set(r.recipeId, link);
    list.push(link);
  }
  return out;
}

export function linkedRecipesForUnits(
  unitIds: number[],
): Map<number, RecipeLink[]> {
  return collectRecipeJoin(
    unitIds,
    recipeIngredient.unitId,
    /* viaSection */ true,
  );
}

/**
 * For each unit, the articles whose per-ingredient conversions reference it —
 * on EITHER side of the edge (`from_unit_id` or `to_unit_id`). The unit-side
 * mirror of {@link linkedRecipesForIngredients}: one entry per ingredient,
 * carrying every conversion of that ingredient that touches the unit. Grouped
 * per owning unit id; ingredients sorted by name, capped at {@link
 * LIMIT_PER_ID}.
 */
export function linkedIngredientConversionsForUnits(
  unitIds: number[],
): Map<number, IngredientConversionLink[]> {
  const out = new Map<number, IngredientConversionLink[]>();
  if (unitIds.length === 0) return out;
  for (const id of unitIds) out.set(id, []);

  const fromUnit = alias(unit, "from_unit");
  const toUnit = alias(unit, "to_unit");
  const rows = db
    .select({
      fromUnitId: ingredientUnitConversion.fromUnitId,
      toUnitId: ingredientUnitConversion.toUnitId,
      ingredientId: ingredientUnitConversion.ingredientId,
      ingredientName: ingredient.name,
      fromUnitName: fromUnit.name,
      toUnitName: toUnit.name,
      factor: ingredientUnitConversion.factor,
      isContainer: ingredientUnitConversion.isContainer,
    })
    .from(ingredientUnitConversion)
    .innerJoin(ingredient, eq(ingredient.id, ingredientUnitConversion.ingredientId))
    .innerJoin(fromUnit, eq(fromUnit.id, ingredientUnitConversion.fromUnitId))
    .innerJoin(toUnit, eq(toUnit.id, ingredientUnitConversion.toUnitId))
    .where(
      or(
        inArray(ingredientUnitConversion.fromUnitId, unitIds),
        inArray(ingredientUnitConversion.toUnitId, unitIds),
      ),
    )
    .orderBy(asc(ingredient.name))
    .all();

  // Per owning unit, group conversions by ingredient (one link per article).
  const byUnit = new Map<number, Map<number, IngredientConversionLink>>();
  for (const id of unitIds) byUnit.set(id, new Map());
  for (const r of rows) {
    const usage = {
      fromUnitName: r.fromUnitName,
      toUnitName: r.toUnitName,
      factor: r.factor,
      isContainer: r.isContainer,
    };
    // A single edge can name the unit on either end; attribute it to each
    // selected unit it touches (the unique index keeps from/to distinct).
    for (const ownerId of [r.fromUnitId, r.toUnitId]) {
      const byIngredient = byUnit.get(ownerId);
      const list = out.get(ownerId);
      if (!byIngredient || !list) continue;
      const existing = byIngredient.get(r.ingredientId);
      if (existing) {
        existing.conversions.push(usage);
        continue;
      }
      if (list.length >= LIMIT_PER_ID) continue;
      const link: IngredientConversionLink = {
        id: r.ingredientId,
        name: r.ingredientName,
        conversions: [usage],
      };
      byIngredient.set(r.ingredientId, link);
      list.push(link);
    }
  }
  return out;
}

export function linkedRecipesForTags(
  tagIds: number[],
): Map<number, RecipeLink[]> {
  const out = new Map<number, RecipeLink[]>();
  if (tagIds.length === 0) return out;
  for (const id of tagIds) out.set(id, []);

  const rows = db
    .select({
      ownerId: recipeTag.tagId,
      recipeId: recipe.id,
      title: recipe.title,
    })
    .from(recipeTag)
    .innerJoin(recipe, eq(recipe.id, recipeTag.recipeId))
    .where(inArray(recipeTag.tagId, tagIds))
    .orderBy(asc(recipe.title))
    .all();

  for (const r of rows) {
    const list = out.get(r.ownerId);
    if (!list) continue;
    if (list.length >= LIMIT_PER_ID) continue;
    list.push({ id: r.recipeId, title: r.title });
  }
  return out;
}

function collectRecipeJoin(
  ids: number[],
  ownerColumn: typeof recipeIngredient.ingredientId | typeof recipeIngredient.unitId,
  viaSection: boolean,
): Map<number, RecipeLink[]> {
  const out = new Map<number, RecipeLink[]>();
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, []);

  void viaSection; // currently always true; kept for future expansion

  const seenPerOwner = new Map<number, Set<number>>();
  for (const id of ids) seenPerOwner.set(id, new Set());

  const rows = db
    .select({
      ownerId: ownerColumn,
      recipeId: recipe.id,
      title: recipe.title,
    })
    .from(recipeIngredient)
    .innerJoin(
      recipeSection,
      eq(recipeSection.id, recipeIngredient.sectionId),
    )
    .innerJoin(recipe, eq(recipe.id, recipeSection.recipeId))
    .where(inArray(ownerColumn, ids))
    .orderBy(asc(recipe.title))
    .all();

  for (const r of rows) {
    if (r.ownerId == null) continue;
    const list = out.get(r.ownerId);
    const seen = seenPerOwner.get(r.ownerId);
    if (!list || !seen) continue;
    if (seen.has(r.recipeId)) continue;
    if (list.length >= LIMIT_PER_ID) continue;
    seen.add(r.recipeId);
    list.push({ id: r.recipeId, title: r.title });
  }
  return out;
}

