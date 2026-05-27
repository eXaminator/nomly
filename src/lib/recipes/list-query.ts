import type { ListRecipesOptions } from "./service.ts";

/** Shared parsing for the recipe-list filter params, used by both the
 *  `/rezepte` page (SSR first page) and `GET /api/v1/recipes` (full list).
 *  Keeping it in one place guarantees the server-rendered slice and the
 *  client-fetched list apply identical filters. */

export function parseTagList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseDiet(
  raw: string | null | undefined,
): "vegetarian" | "vegan" | undefined {
  if (raw === "vegan") return "vegan";
  if (raw === "vegetarian") return "vegetarian";
  return undefined;
}

export function toListOptions(params: {
  q?: string | null;
  must?: string | null;
  not?: string | null;
  diet?: string | null;
}): ListRecipesOptions {
  return {
    query: params.q ?? undefined,
    mustTags: parseTagList(params.must),
    notTags: parseTagList(params.not),
    diet: parseDiet(params.diet),
  };
}

/** Whether any filter is active — drives the "no matches" vs "no recipes yet"
 *  empty state. */
export function filtersActive(opts: ListRecipesOptions): boolean {
  return Boolean(
    opts.query?.trim().length ||
      opts.mustTags?.length ||
      opts.notTags?.length ||
      opts.diet,
  );
}
