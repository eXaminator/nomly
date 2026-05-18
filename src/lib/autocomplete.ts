import { asc, desc, eq, like, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  category,
  categoryAlias,
  ingredient,
  ingredientAlias,
  recipeIngredient,
  unit,
  unitAlias,
} from "../db/schema.ts";

const norm = (s: string) => s.trim();
const lower = (s: string) => norm(s).toLowerCase();

export type AutocompleteHit = {
  id: number;
  name: string;
  /** When present, the search matched on this alias. The UI may surface it. */
  matchedAlias?: string;
};

export type IngredientSuggestion = {
  ingredientId: number;
  /** The label the user sees (and that becomes the input value when picked). */
  name: string;
  /** When this entry came from an alias, the canonical ingredient name. */
  canonicalName?: string;
};

const LIMIT = 20;

function buildLikePattern(query: string): string {
  return `%${query.replace(/[%_]/g, "\\$&")}%`;
}

/**
 * Returns ingredient-name suggestions where canonical names and aliases are
 * both first-class entries. Picking an alias (e.g. "Tomaten") sets the user's
 * input to that alias name; storage will still resolve the row to the
 * canonical ingredient ("Tomate") via {@link findIngredientByName} on save.
 */
export function searchIngredients(query: string): IngredientSuggestion[] {
  const q = norm(query);
  if (q.length === 0) return [];
  const pattern = buildLikePattern(q);

  const canonical = db
    .select({ id: ingredient.id, name: ingredient.name })
    .from(ingredient)
    .where(like(ingredient.name, pattern))
    .orderBy(asc(ingredient.name))
    .limit(LIMIT)
    .all();

  const aliasHits = db
    .select({
      ingredientId: ingredient.id,
      canonicalName: ingredient.name,
      aliasName: ingredientAlias.name,
    })
    .from(ingredientAlias)
    .innerJoin(ingredient, eq(ingredient.id, ingredientAlias.ingredientId))
    .where(like(ingredientAlias.name, pattern))
    .orderBy(asc(ingredientAlias.name))
    .limit(LIMIT)
    .all();

  const merged: IngredientSuggestion[] = [
    ...canonical.map((c) => ({ ingredientId: c.id, name: c.name })),
    ...aliasHits.map((a) => ({
      ingredientId: a.ingredientId,
      name: a.aliasName,
      canonicalName: a.canonicalName,
    })),
  ];

  // De-duplicate (canonical "Tomate" + alias "Tomate" → keep one), case-
  // insensitive on the display label.
  const seen = new Map<string, IngredientSuggestion>();
  for (const m of merged) {
    const key = m.name.toLowerCase();
    if (!seen.has(key)) seen.set(key, m);
  }

  return Array.from(seen.values())
    .sort((a, b) => rankSuggestion(a, q) - rankSuggestion(b, q))
    .slice(0, LIMIT);
}

function rankSuggestion(s: IngredientSuggestion, query: string): number {
  const n = s.name.toLowerCase();
  const q = query.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  return 2;
}

export function searchUnits(query: string): AutocompleteHit[] {
  const q = norm(query);
  if (q.length === 0) return [];
  const pattern = buildLikePattern(q);

  const canonical = db
    .select({ id: unit.id, name: unit.name })
    .from(unit)
    .where(like(unit.name, pattern))
    .orderBy(asc(unit.name))
    .limit(LIMIT)
    .all();

  const aliasHits = db
    .select({
      id: unit.id,
      name: unit.name,
      matchedAlias: unitAlias.name,
    })
    .from(unitAlias)
    .innerJoin(unit, eq(unit.id, unitAlias.unitId))
    .where(like(unitAlias.name, pattern))
    .orderBy(asc(unitAlias.name))
    .limit(LIMIT)
    .all();

  return mergeHits(canonical, aliasHits, q);
}

/**
 * Returns every unit ordered by how often it appears in
 * `recipe_ingredient` (descending), name as a tiebreaker. Used to seed the
 * unit picker so the most-used units bubble to the top.
 */
export function listUnitsByUsage(): Array<AutocompleteHit & { usageCount: number }> {
  const rows = db
    .select({
      id: unit.id,
      name: unit.name,
      usageCount: sql<number>`count(${recipeIngredient.id})`.as("usage_count"),
    })
    .from(unit)
    .leftJoin(recipeIngredient, eq(recipeIngredient.unitId, unit.id))
    .groupBy(unit.id)
    .orderBy(desc(sql`usage_count`), asc(unit.name))
    .all();
  return rows.map((r) => ({ id: r.id, name: r.name, usageCount: r.usageCount }));
}

export function searchCategories(query: string): AutocompleteHit[] {
  const q = norm(query);
  if (q.length === 0) return [];
  const pattern = buildLikePattern(q);

  const canonical = db
    .select({ id: category.id, name: category.name })
    .from(category)
    .where(like(category.name, pattern))
    .orderBy(asc(category.name))
    .limit(LIMIT)
    .all();

  const aliasHits = db
    .select({
      id: category.id,
      name: category.name,
      matchedAlias: categoryAlias.name,
    })
    .from(categoryAlias)
    .innerJoin(category, eq(category.id, categoryAlias.categoryId))
    .where(like(categoryAlias.name, pattern))
    .orderBy(asc(categoryAlias.name))
    .limit(LIMIT)
    .all();

  return mergeHits(canonical, aliasHits, q);
}

function mergeHits(
  canonical: Array<{ id: number; name: string }>,
  aliasHits: Array<{ id: number; name: string; matchedAlias: string }>,
  query: string,
): AutocompleteHit[] {
  const out = new Map<number, AutocompleteHit>();
  // Exact canonical match first; otherwise prefix matches; otherwise the rest.
  for (const c of canonical) out.set(c.id, { id: c.id, name: c.name });
  for (const a of aliasHits) {
    if (!out.has(a.id)) {
      out.set(a.id, { id: a.id, name: a.name, matchedAlias: a.matchedAlias });
    }
  }
  return Array.from(out.values())
    .sort((a, b) => rank(a, query) - rank(b, query))
    .slice(0, LIMIT);
}

function rank(hit: AutocompleteHit, query: string): number {
  const q = lower(query);
  const n = lower(hit.name);
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (hit.matchedAlias && lower(hit.matchedAlias) === q) return 2;
  return 3;
}

// --- inline create helpers (Epic 3 scope: limited fields per spec §7.1) ---

export function createIngredient(name: string): { id: number; name: string } {
  const cleaned = norm(name);
  if (cleaned.length === 0) {
    throw new Error("ingredient name is required");
  }
  const collision = findCanonicalOrAlias(cleaned);
  if (collision.namespace !== "none") {
    throw new Error(
      `name "${cleaned}" is already used as ${collision.namespace}`,
    );
  }
  const inserted = db
    .insert(ingredient)
    .values({ name: cleaned })
    .returning({ id: ingredient.id, name: ingredient.name })
    .all();
  return inserted[0];
}

export function createUnit(
  name: string,
  dimension: "mass" | "volume" | "count",
): { id: number; name: string } {
  const cleaned = norm(name);
  if (cleaned.length === 0) throw new Error("unit name is required");
  const existing = db
    .select({ id: unit.id })
    .from(unit)
    .where(eq(unit.name, cleaned))
    .get();
  if (existing) throw new Error(`unit "${cleaned}" already exists`);
  const inserted = db
    .insert(unit)
    .values({ name: cleaned, dimension, factor: 1 })
    .returning({ id: unit.id, name: unit.name })
    .all();
  return inserted[0];
}

export function createCategory(name: string): { id: number; name: string } {
  const cleaned = norm(name);
  if (cleaned.length === 0) throw new Error("category name is required");
  const existing = db
    .select({ id: category.id })
    .from(category)
    .where(eq(category.name, cleaned))
    .get();
  if (existing) throw new Error(`category "${cleaned}" already exists`);
  const inserted = db
    .insert(category)
    .values({ name: cleaned })
    .returning({ id: category.id, name: category.name })
    .all();
  return inserted[0];
}

function findCanonicalOrAlias(
  name: string,
): { namespace: "ingredient" | "ingredientAlias" | "none" } {
  const hit = db
    .select()
    .from(ingredient)
    .where(eq(ingredient.name, name))
    .get();
  if (hit) return { namespace: "ingredient" };
  const aliasHit = db
    .select()
    .from(ingredientAlias)
    .where(eq(ingredientAlias.name, name))
    .get();
  if (aliasHit) return { namespace: "ingredientAlias" };
  return { namespace: "none" };
}
