import { asc, eq, inArray } from "drizzle-orm";

import { db } from "../../../db/index.ts";
import {
  recipe,
  recipeIngredient,
  recipeSection,
  recipeTag,
} from "../../../db/schema.ts";

import type { RecipeLink } from "./types.ts";

const LIMIT_PER_ID = 50;

/**
 * Returns up to `LIMIT_PER_ID` distinct recipes per ingredient id, joined
 * through `recipe_section`. Used by the impact endpoint to render a
 * clickable "Verwendung" list in the ingredient editor.
 */
export function linkedRecipesForIngredients(
  ingredientIds: number[],
): Map<number, RecipeLink[]> {
  return collectRecipeJoin(
    ingredientIds,
    recipeIngredient.ingredientId,
    /* viaSection */ true,
  );
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

