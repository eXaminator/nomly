"use client";

import * as React from "react";
import type { PlannerRecipe } from "@/lib/recipes/types";

// Session-level cache for the UNFILTERED catalog: the planner mounts this on
// every /plan visit (for drag previews and optimistic meal creation), but the
// lightweight catalog rarely changes within a session, so fetch it once and
// reuse it across navigations. Filtered queries always hit the network so they
// stay in lockstep with the server-side `listRecipes` filtering — the exact
// same code path the main /rezepte list uses.
let unfilteredCache: PlannerRecipe[] | null = null;
let unfilteredInflight: Promise<PlannerRecipe[]> | null = null;

function fetchLight(query: string): Promise<PlannerRecipe[]> {
  const url = `/api/v1/recipes?fields=light${query ? `&${query}` : ""}`;
  return fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
    .then((data: { recipes: PlannerRecipe[] }) => data.recipes);
}

/**
 * Load the lightweight recipe catalog, optionally filtered by an
 * already-serialised query string (`q=…&must=…&not=…&diet=…`). The empty-query
 * result is cached and shared; filtered queries fetch fresh every time so the
 * planner's filtering matches the main recipe list bit-for-bit.
 */
export function loadPlannerRecipes(query = ""): Promise<PlannerRecipe[]> {
  if (query !== "") return fetchLight(query);
  if (unfilteredCache) return Promise.resolve(unfilteredCache);
  if (!unfilteredInflight) {
    unfilteredInflight = fetchLight("")
      .then((r) => (unfilteredCache = r))
      .finally(() => {
        unfilteredInflight = null;
      });
  }
  return unfilteredInflight;
}

/** Synchronous peek at the cached unfiltered catalog — lets consumers seed
 *  initial state without a loading flash when it's already in memory. */
export function peekPlannerRecipes(): PlannerRecipe[] | null {
  return unfilteredCache;
}

export function useRecipeCatalog(): {
  recipes: PlannerRecipe[];
  loading: boolean;
  error: boolean;
} {
  const [recipes, setRecipes] = React.useState<PlannerRecipe[]>(
    unfilteredCache ?? [],
  );
  const [loading, setLoading] = React.useState(unfilteredCache === null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    // `loadPlannerRecipes()` resolves synchronously-cached data on a microtask,
    // so updating state here is always async (no cascading-render lint issue).
    // The initial state above already seeds from the cache when present.
    loadPlannerRecipes()
      .then((r) => {
        if (active) {
          setRecipes(r);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return { recipes, loading, error };
}
