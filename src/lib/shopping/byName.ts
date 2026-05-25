import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { ingredient, ingredientAlias } from "../../db/schema.ts";

export type NameCandidate = {
  kind: "ingredient";
  id: number;
  name: string;
  matchedAlias?: string;
};

/**
 * Resolve a free-text item name against `ingredient` + `ingredient_alias`
 * (diacritic-insensitive exact match, then substring match).
 *
 * Returns one of:
 *   - `{ mode: "match", candidate }` when exactly one hit
 *   - `{ mode: "ambiguous", candidates }` when ≥2 distinct ingredients match
 *   - `{ mode: "none" }` when nothing matches (caller may auto-create an
 *     ingredient via `createIngredientFromName`)
 *
 * Exact matches always win over substring matches even when both exist.
 * Alias hits on the same ingredient collapse to a single candidate (with the
 * alias surfaced).
 */
export function resolveByName(
  rawName: string,
):
  | { mode: "match"; candidate: NameCandidate }
  | { mode: "ambiguous"; candidates: NameCandidate[] }
  | { mode: "none" } {
  const name = rawName.trim();
  if (name.length === 0) return { mode: "none" };

  const exact = collect(name, "exact");
  if (exact.length === 1) return { mode: "match", candidate: exact[0] };
  if (exact.length > 1) return { mode: "ambiguous", candidates: exact };

  const partial = collect(name, "substring");
  if (partial.length === 1) return { mode: "match", candidate: partial[0] };
  if (partial.length > 1) return { mode: "ambiguous", candidates: partial };

  return { mode: "none" };
}

function collect(
  name: string,
  mode: "exact" | "substring",
): NameCandidate[] {
  const out = new Map<number, NameCandidate>();

  const matcher =
    mode === "exact"
      ? (col: ReturnType<typeof sqlCol>) =>
          sql`unaccent(${col}) = unaccent(${name})`
      : (col: ReturnType<typeof sqlCol>) =>
          sql`unaccent(${col}) LIKE ${"%" + sqlEscape(name) + "%"}`;

  const ingredientHits = db
    .select({ id: ingredient.id, name: ingredient.name })
    .from(ingredient)
    .where(matcher(sqlCol(ingredient.name)))
    .all();
  for (const i of ingredientHits) {
    if (!out.has(i.id)) {
      out.set(i.id, { kind: "ingredient", id: i.id, name: i.name });
    }
  }

  const aliasHits = db
    .select({
      id: ingredient.id,
      name: ingredient.name,
      alias: ingredientAlias.name,
    })
    .from(ingredientAlias)
    .innerJoin(ingredient, eq(ingredient.id, ingredientAlias.ingredientId))
    .where(matcher(sqlCol(ingredientAlias.name)))
    .all();
  for (const i of aliasHits) {
    if (!out.has(i.id)) {
      out.set(i.id, {
        kind: "ingredient",
        id: i.id,
        name: i.name,
        matchedAlias: i.alias,
      });
    }
  }

  return Array.from(out.values());
}

function sqlCol<T>(col: T): T {
  return col;
}

function sqlEscape(s: string): string {
  return s.replace(/[%_]/g, "\\$&");
}

export function createIngredientFromName(
  name: string,
  defaultCategoryId: number | null = null,
): { id: number; name: string } {
  const trimmed = name.trim();
  const inserted = db
    .insert(ingredient)
    .values({ name: trimmed, defaultCategoryId })
    .returning({ id: ingredient.id, name: ingredient.name })
    .all();
  return inserted[0];
}
