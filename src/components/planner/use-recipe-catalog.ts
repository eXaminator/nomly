"use client";

import * as React from "react";
import type { PlannerRecipe } from "@/lib/recipes/types";

// Session-level cache: the planner mounts this on every /plan visit, but the
// lightweight catalog rarely changes within a session, so fetch it once and
// reuse it across navigations.
let cache: PlannerRecipe[] | null = null;
let inflight: Promise<PlannerRecipe[]> | null = null;

function load(): Promise<PlannerRecipe[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch("/api/v1/recipes?fields=light")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((data: { recipes: PlannerRecipe[] }) => {
        cache = data.recipes;
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useRecipeCatalog(): {
  recipes: PlannerRecipe[];
  loading: boolean;
  error: boolean;
} {
  const [recipes, setRecipes] = React.useState<PlannerRecipe[]>(cache ?? []);
  const [loading, setLoading] = React.useState(cache === null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    if (cache) {
      setRecipes(cache);
      setLoading(false);
      return;
    }
    let active = true;
    load()
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
