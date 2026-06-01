"use client";

import * as React from "react";
import {
  recipeFilterToQuery,
  type RecipeFilterValue,
} from "@/components/recipes/recipe-filter-bar";
import type { PlannerRecipe } from "@/lib/recipes/types";
import { loadPlannerRecipes, peekPlannerRecipes } from "./use-recipe-catalog";

/**
 * Fetches the filtered lightweight catalog from `GET /api/v1/recipes`, the
 * exact endpoint + `listRecipes` path the main list uses, via the shared
 * {@link recipeFilterToQuery} serialisation. Previous results stay visible
 * while a new query is in flight (no flash to empty), and the cached unfiltered
 * catalog seeds the initial render when available.
 */
export function useFilteredRecipes(filter: RecipeFilterValue): {
  recipes: PlannerRecipe[];
  loading: boolean;
  error: boolean;
} {
  const query = recipeFilterToQuery(filter);
  const seed = query === "" ? peekPlannerRecipes() : null;
  const [recipes, setRecipes] = React.useState<PlannerRecipe[]>(seed ?? []);
  const [loading, setLoading] = React.useState(seed === null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    // Don't flip to a loading/empty state here — keep the previous results on
    // screen until the new query resolves so changing a filter never flashes
    // empty (mirrors how the main /rezepte grid keeps its list visible).
    loadPlannerRecipes(query)
      .then((r) => {
        if (!active) return;
        setRecipes(r);
        setError(false);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query]);

  return { recipes, loading, error };
}
