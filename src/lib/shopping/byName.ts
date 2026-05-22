import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  ingredient,
  ingredientAlias,
  product,
  productAlias,
} from "../../db/schema.ts";

export type NameCandidate =
  | { kind: "ingredient"; id: number; name: string; matchedAlias?: string }
  | { kind: "product"; id: number; name: string; matchedAlias?: string };

/**
 * Resolve a free-text item name against `ingredient`, `ingredient_alias`,
 * `product`, `product_alias` — diacritic-insensitive exact match, then
 * substring match.
 *
 * Returns one of:
 *   - `{ mode: "match", candidate }` when exactly one hit
 *   - `{ mode: "ambiguous", candidates }` when ≥2 distinct refs match
 *   - `{ mode: "none" }` when nothing matches (caller may auto-create a product)
 *
 * Exact matches always win over substring matches even when both exist.
 * "Distinct refs" means a unique `(kind, id)` pair — alias hits on the same
 * ingredient collapse to a single candidate (with the alias surfaced).
 */
export function resolveByName(
  rawName: string,
): { mode: "match"; candidate: NameCandidate }
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
  const out = new Map<string, NameCandidate>();
  const seen = (c: NameCandidate) => `${c.kind}:${c.id}`;

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
    const c: NameCandidate = { kind: "ingredient", id: i.id, name: i.name };
    if (!out.has(seen(c))) out.set(seen(c), c);
  }

  const ingredientAliasHits = db
    .select({
      id: ingredient.id,
      name: ingredient.name,
      alias: ingredientAlias.name,
    })
    .from(ingredientAlias)
    .innerJoin(ingredient, eq(ingredient.id, ingredientAlias.ingredientId))
    .where(matcher(sqlCol(ingredientAlias.name)))
    .all();
  for (const i of ingredientAliasHits) {
    const c: NameCandidate = {
      kind: "ingredient",
      id: i.id,
      name: i.name,
      matchedAlias: i.alias,
    };
    if (!out.has(seen(c))) out.set(seen(c), c);
  }

  const productHits = db
    .select({ id: product.id, name: product.name })
    .from(product)
    .where(matcher(sqlCol(product.name)))
    .all();
  for (const p of productHits) {
    const c: NameCandidate = { kind: "product", id: p.id, name: p.name };
    if (!out.has(seen(c))) out.set(seen(c), c);
  }

  const productAliasHits = db
    .select({
      id: product.id,
      name: product.name,
      alias: productAlias.name,
    })
    .from(productAlias)
    .innerJoin(product, eq(product.id, productAlias.productId))
    .where(matcher(sqlCol(productAlias.name)))
    .all();
  for (const p of productAliasHits) {
    const c: NameCandidate = {
      kind: "product",
      id: p.id,
      name: p.name,
      matchedAlias: p.alias,
    };
    if (!out.has(seen(c))) out.set(seen(c), c);
  }

  return Array.from(out.values());
}

// Keep the `matcher` factory's column argument typed without leaking the
// underlying Drizzle column generic into the public surface.
function sqlCol<T>(col: T): T {
  return col;
}

function sqlEscape(s: string): string {
  return s.replace(/[%_]/g, "\\$&");
}

export function createProductFromName(
  name: string,
  defaultCategoryId: number | null = null,
): { id: number; name: string } {
  const trimmed = name.trim();
  const inserted = db
    .insert(product)
    .values({ name: trimmed, defaultCategoryId })
    .returning({ id: product.id, name: product.name })
    .all();
  return inserted[0];
}
