"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { RecipeCard } from "./recipe-card";
import type { RecipeListItem } from "@/lib/recipes/types";

type Props = {
  recipes: RecipeListItem[];
  /** True when the server-side query narrowed the result set (i.e. `?q=`
   *  is set). Used only to phrase the empty-state copy. */
  serverQueryActive: boolean;
};

function parseTagSet(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

/**
 * Client-side tag filter on top of the recipe list the server already shipped.
 * The server resolves `?q=` (full-text-ish search) but ignores `?must=` /
 * `?not=` — tag toggling stays in the browser so each chip click is instant
 * instead of round-tripping a full SSR pass through ~300 cards.
 */
export function RecipeGrid({ recipes, serverQueryActive }: Props) {
  const params = useSearchParams();

  const filtered = React.useMemo(() => {
    const mustSet = parseTagSet(params.get("must"));
    const notSet = parseTagSet(params.get("not"));
    if (mustSet.size === 0 && notSet.size === 0) return recipes;
    return recipes.filter((r) => {
      const have = new Set(r.tags.map((t) => t.toLowerCase()));
      for (const m of mustSet) if (!have.has(m)) return false;
      for (const n of notSet) if (have.has(n)) return false;
      return true;
    });
  }, [recipes, params]);

  const total = recipes.length;
  const shown = filtered.length;
  const filterActive = shown !== total;

  return (
    <>
      <p className="mt-2 text-sm text-[var(--color-muted-fg)]">
        {shown === 0
          ? serverQueryActive || filterActive
            ? "Keine Treffer mit den aktuellen Filtern."
            : "Noch keine Rezepte – jetzt das erste anlegen."
          : filterActive
            ? `${shown} von ${total} Rezepten.`
            : `${total} Rezept${total === 1 ? "" : "e"}.`}
      </p>
      <div className="mt-6 grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((r) => (
          <RecipeCard key={r.id} recipe={r} />
        ))}
      </div>
    </>
  );
}
