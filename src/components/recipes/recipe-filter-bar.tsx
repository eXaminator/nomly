"use client";

import { DietFilter, type DietChoice } from "./diet-filter";
import { NeedsUpdateFilter } from "./needs-update-filter";
import { RandomizeButton } from "./randomize-button";
import { RecipeSearch } from "./recipe-search";
import { TagFilterBar, type TagFilterValue } from "./tag-filter-bar";

/**
 * The complete set of recipe-list filters as a single value. Mirrors the params
 * the API (`GET /api/v1/recipes`) and server-side `listRecipes` understand, so
 * every surface funnels through identical filtering — including the advanced
 * search syntax (`zutat:`, phrases, OR, negation, typo tolerance).
 */
export type RecipeFilterValue = {
  q: string;
  tags: TagFilterValue;
  diet: DietChoice;
  needsUpdate: boolean;
};

export const EMPTY_RECIPE_FILTER: RecipeFilterValue = {
  q: "",
  tags: { must: [], not: [] },
  diet: "all",
  needsUpdate: false,
};

/** Serialise the filter into the query string the recipes API expects — the
 *  same shape `/rezepte` keeps in its URL. */
export function recipeFilterToQuery(f: RecipeFilterValue): string {
  const p = new URLSearchParams();
  const q = f.q.trim();
  if (q) p.set("q", q);
  if (f.tags.must.length > 0) p.set("must", f.tags.must.join(","));
  if (f.tags.not.length > 0) p.set("not", f.tags.not.join(","));
  if (f.diet !== "all") p.set("diet", f.diet);
  if (f.needsUpdate) p.set("update", "1");
  return p.toString();
}

type Props = {
  allTags: string[];
  /** Controlled mode: pass BOTH to keep filter state in React (the planner).
   *  Omit both to run URL-backed, where each control reads/writes the page URL
   *  (the `/rezepte` list). Either way the same controls render, so adding a
   *  filter here adds it to every list. */
  value?: RecipeFilterValue;
  onChange?: (next: RecipeFilterValue) => void;
};

/**
 * The single recipe-filter bar shared by the main `/rezepte` list and the
 * planner surfaces (side panel + add-meal modal). Renders search, diet,
 * "needs update", randomize and tag filters. Must be rendered inside a
 * {@link RandomizeProvider} so the randomize control has its context.
 */
export function RecipeFilterBar({ allTags, value, onChange }: Props) {
  // Both-or-neither: a single patch helper proves controlled mode and feeds
  // every sub-control. When absent the controls fall back to URL-backed mode.
  const patch =
    value && onChange
      ? (next: Partial<RecipeFilterValue>) => onChange({ ...value, ...next })
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <RecipeSearch
        value={value?.q}
        onChange={patch ? (q) => patch({ q }) : undefined}
      />
      <div className="flex flex-wrap items-center gap-3">
        <DietFilter
          value={value?.diet}
          onChange={patch ? (diet) => patch({ diet }) : undefined}
        />
        <NeedsUpdateFilter
          value={value?.needsUpdate}
          onChange={patch ? (needsUpdate) => patch({ needsUpdate }) : undefined}
        />
        <RandomizeButton />
      </div>
      {allTags.length > 0 ? (
        <TagFilterBar
          allTags={allTags}
          value={value?.tags}
          onChange={patch ? (tags) => patch({ tags }) : undefined}
        />
      ) : null}
    </div>
  );
}
