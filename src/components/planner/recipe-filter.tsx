"use client";

import * as React from "react";
import { DietFilter, type DietChoice } from "@/components/recipes/diet-filter";
import { RecipeSearch } from "@/components/recipes/recipe-search";
import {
  TagFilterBar,
  type TagFilterValue,
} from "@/components/recipes/tag-filter-bar";
import type { PlannerRecipe } from "@/lib/recipes/types";
import {
  loadPlannerRecipes,
  peekPlannerRecipes,
} from "./use-recipe-catalog";

/**
 * Recipe filter state for the planner surfaces (the side panel and the
 * add-meal modal). Mirrors the params the main `/rezepte` list reads from the
 * URL so both views funnel through the identical server-side `listRecipes`
 * filtering — including the advanced search syntax (`zutat:`, phrases, OR,
 * negation, typo tolerance) that a naive client-side substring match can't do.
 */
export type PlannerRecipeFilter = {
  q: string;
  tags: TagFilterValue;
  diet: DietChoice;
};

export const EMPTY_RECIPE_FILTER: PlannerRecipeFilter = {
  q: "",
  tags: { must: [], not: [] },
  diet: "all",
};

/** Serialise the filter into the query string the recipes API expects, which
 *  is the same shape `/rezepte` puts in the URL. */
function filterToQuery(f: PlannerRecipeFilter): string {
  const p = new URLSearchParams();
  const q = f.q.trim();
  if (q) p.set("q", q);
  if (f.tags.must.length > 0) p.set("must", f.tags.must.join(","));
  if (f.tags.not.length > 0) p.set("not", f.tags.not.join(","));
  if (f.diet !== "all") p.set("diet", f.diet);
  return p.toString();
}

/**
 * The shared filter controls — the very same `RecipeSearch`, `DietFilter` and
 * `TagFilterBar` components the main list uses, here in controlled mode so the
 * filter state stays in local React state instead of the /plan URL.
 */
export function RecipeFilterControls({
  allTags,
  value,
  onChange,
}: {
  allTags: string[];
  value: PlannerRecipeFilter;
  onChange: (next: PlannerRecipeFilter) => void;
}) {
  return (
    <>
      <RecipeSearch
        value={value.q}
        onChange={(q) => onChange({ ...value, q })}
      />
      <DietFilter
        value={value.diet}
        onChange={(diet) => onChange({ ...value, diet })}
      />
      {allTags.length > 0 ? (
        <TagFilterBar
          allTags={allTags}
          value={value.tags}
          onChange={(tags) => onChange({ ...value, tags })}
        />
      ) : null}
    </>
  );
}

/**
 * Fetches the filtered lightweight catalog from `GET /api/v1/recipes`, the
 * exact endpoint + `listRecipes` path the main list uses. Previous results
 * stay visible while a new query is in flight (no flash to empty), and the
 * cached unfiltered catalog seeds the initial render when available.
 */
export function useFilteredRecipes(filter: PlannerRecipeFilter): {
  recipes: PlannerRecipe[];
  loading: boolean;
  error: boolean;
} {
  const query = filterToQuery(filter);
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
