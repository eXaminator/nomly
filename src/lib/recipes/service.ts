import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  recipe,
  recipeIngredient,
  recipeSection,
  recipeTag,
  tag,
  ingredient as ingredientTable,
  ingredientAlias as ingredientAliasTable,
  unit as unitTable,
} from "../../db/schema.ts";
import type {
  RecipeInput,
  RecipeListItem,
  RecipeView,
} from "./types.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const norm = (s: string) => s.trim();
const nowSec = () => Math.floor(Date.now() / 1000);

function resolveTags(tx: Tx, names: string[]): number[] {
  const unique = Array.from(
    new Map(
      names
        .map((n) => norm(n))
        .filter((n) => n.length > 0)
        .map((n) => [n.toLowerCase(), n]),
    ).values(),
  );
  const ids: number[] = [];
  for (const name of unique) {
    const existing = tx
      .select({ id: tag.id })
      .from(tag)
      .where(eq(tag.name, name))
      .get();
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const inserted = tx
      .insert(tag)
      .values({ name })
      .returning({ id: tag.id })
      .all();
    ids.push(inserted[0].id);
  }
  return ids;
}

/**
 * Resolve a freeform ingredient name to an existing row, or insert a new one.
 * Matches case-insensitively against `ingredient.name` first, then against
 * `ingredient_alias.name`. The newly-created row preserves the user's casing.
 */
function resolveIngredient(tx: Tx, rawName: string): number {
  const cleaned = norm(rawName);
  if (cleaned.length === 0) {
    throw new Error("ingredient name is required");
  }
  const lowered = cleaned.toLowerCase();

  const canonical = tx
    .select({ id: ingredientTable.id })
    .from(ingredientTable)
    .where(sql`lower(${ingredientTable.name}) = ${lowered}`)
    .get();
  if (canonical) return canonical.id;

  const aliased = tx
    .select({ id: ingredientTable.id })
    .from(ingredientAliasTable)
    .innerJoin(
      ingredientTable,
      eq(ingredientTable.id, ingredientAliasTable.ingredientId),
    )
    .where(sql`lower(${ingredientAliasTable.name}) = ${lowered}`)
    .get();
  if (aliased) return aliased.id;

  const inserted = tx
    .insert(ingredientTable)
    .values({ name: cleaned })
    .returning({ id: ingredientTable.id })
    .all();
  return inserted[0].id;
}

function writeSections(
  tx: Tx,
  recipeId: number,
  sections: RecipeInput["sections"],
) {
  sections.forEach((section, sIdx) => {
    const sectionRow = tx
      .insert(recipeSection)
      .values({
        recipeId,
        title: section.title?.trim() || null,
        instructions: section.instructions,
        sortOrder: sIdx,
      })
      .returning({ id: recipeSection.id })
      .all();
    const sectionId = sectionRow[0].id;

    section.ingredients.forEach((ing, iIdx) => {
      const ingredientId = resolveIngredient(tx, ing.ingredientName);
      tx.insert(recipeIngredient)
        .values({
          sectionId,
          ingredientId,
          quantity: ing.quantity,
          unitId: ing.unitId,
          notes: ing.notes,
          sortOrder: iIdx,
        })
        .run();
    });
  });
}

function writeTags(tx: Tx, recipeId: number, tagNames: string[]) {
  const tagIds = resolveTags(tx, tagNames);
  for (const tagId of tagIds) {
    tx.insert(recipeTag).values({ recipeId, tagId }).run();
  }
}

export function createRecipe(input: RecipeInput): number {
  return db.transaction((tx) => {
    const inserted = tx
      .insert(recipe)
      .values({
        title: input.title.trim(),
        description: input.description?.trim() || null,
        sourceUrl: input.sourceUrl?.trim() || null,
        photoPath: input.photoPath?.trim() || null,
        servings: input.servings,
        prepTimeMin: input.prepTimeMin,
        cookTimeMin: input.cookTimeMin,
      })
      .returning({ id: recipe.id })
      .all();
    const recipeId = inserted[0].id;
    writeSections(tx, recipeId, input.sections);
    writeTags(tx, recipeId, input.tags);
    return recipeId;
  });
}

export function updateRecipe(id: number, input: RecipeInput): void {
  db.transaction((tx) => {
    const updated = tx
      .update(recipe)
      .set({
        title: input.title.trim(),
        description: input.description?.trim() || null,
        sourceUrl: input.sourceUrl?.trim() || null,
        photoPath: input.photoPath?.trim() || null,
        servings: input.servings,
        prepTimeMin: input.prepTimeMin,
        cookTimeMin: input.cookTimeMin,
        updatedAt: nowSec(),
      })
      .where(eq(recipe.id, id))
      .returning({ id: recipe.id })
      .all();
    if (updated.length === 0) throw new Error(`recipe ${id} not found`);

    // Replace sections + ingredients (cascade handles ingredients) and tag links.
    tx.delete(recipeSection).where(eq(recipeSection.recipeId, id)).run();
    tx.delete(recipeTag).where(eq(recipeTag.recipeId, id)).run();

    writeSections(tx, id, input.sections);
    writeTags(tx, id, input.tags);
  });
}

export function deleteRecipe(id: number): boolean {
  const result = db.delete(recipe).where(eq(recipe.id, id)).run();
  return result.changes > 0;
}

export function getRecipe(id: number): RecipeView | null {
  const head = db.select().from(recipe).where(eq(recipe.id, id)).get();
  if (!head) return null;

  const sections = db
    .select()
    .from(recipeSection)
    .where(eq(recipeSection.recipeId, id))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const sectionIds = sections.map((s) => s.id);
  type IngredientRow = {
    id: number;
    sectionId: number;
    ingredientId: number;
    ingredientName: string;
    quantity: number | null;
    unitId: number | null;
    unitName: string | null;
    notes: string | null;
    sortOrder: number;
  };
  const ingredients: IngredientRow[] =
    sectionIds.length === 0
      ? []
      : db
          .select({
            id: recipeIngredient.id,
            sectionId: recipeIngredient.sectionId,
            ingredientId: recipeIngredient.ingredientId,
            ingredientName: ingredientTable.name,
            quantity: recipeIngredient.quantity,
            unitId: recipeIngredient.unitId,
            unitName: unitTable.name,
            notes: recipeIngredient.notes,
            sortOrder: recipeIngredient.sortOrder,
          })
          .from(recipeIngredient)
          .leftJoin(unitTable, eq(unitTable.id, recipeIngredient.unitId))
          .innerJoin(
            ingredientTable,
            eq(ingredientTable.id, recipeIngredient.ingredientId),
          )
          .where(inArray(recipeIngredient.sectionId, sectionIds))
          .all();

  const tags = db
    .select({ name: tag.name })
    .from(tag)
    .innerJoin(recipeTag, eq(recipeTag.tagId, tag.id))
    .where(eq(recipeTag.recipeId, id))
    .all()
    .map((t) => t.name)
    .sort();

  return {
    id: head.id,
    title: head.title,
    description: head.description,
    photoPath: head.photoPath,
    sourceUrl: head.sourceUrl,
    servings: head.servings,
    prepTimeMin: head.prepTimeMin,
    cookTimeMin: head.cookTimeMin,
    tags,
    sections: sections.map((s) => ({
      id: s.id,
      title: s.title,
      instructions: s.instructions,
      sortOrder: s.sortOrder,
      ingredients: ingredients
        .filter((i) => i.sectionId === s.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => ({
          id: i.id,
          ingredientId: i.ingredientId,
          ingredientName: i.ingredientName,
          quantity: i.quantity,
          unitId: i.unitId,
          unitName: i.unitName,
          notes: i.notes,
          sortOrder: i.sortOrder,
        })),
    })),
    createdAt: head.createdAt,
    updatedAt: head.updatedAt,
  };
}

export function listRecipes(query?: string): RecipeListItem[] {
  const trimmed = query?.trim() ?? "";
  let rows: Array<typeof recipe.$inferSelect>;
  if (trimmed.length === 0) {
    rows = db.select().from(recipe).orderBy(recipe.title).all();
  } else {
    const pattern = `%${trimmed}%`;
    // SQLite LIKE is case-insensitive for ASCII by default.
    const titleHits = db
      .select()
      .from(recipe)
      .where(like(recipe.title, pattern))
      .all();

    const tagHitIds = db
      .selectDistinct({ recipeId: recipeTag.recipeId })
      .from(recipeTag)
      .innerJoin(tag, eq(tag.id, recipeTag.tagId))
      .where(like(tag.name, pattern))
      .all()
      .map((r) => r.recipeId);

    const extraRows =
      tagHitIds.length === 0
        ? []
        : db
            .select()
            .from(recipe)
            .where(
              and(
                inArray(recipe.id, tagHitIds),
                or(...titleHits.map((r) => sql`${recipe.id} != ${r.id}`)) ??
                  sql`1=1`,
              ),
            )
            .all();

    const merged = new Map<number, typeof recipe.$inferSelect>();
    for (const r of [...titleHits, ...extraRows]) merged.set(r.id, r);
    rows = Array.from(merged.values()).sort((a, b) =>
      a.title.localeCompare(b.title, "de"),
    );
  }

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const tagsByRecipe = new Map<number, string[]>();
  const tagRows = db
    .select({ recipeId: recipeTag.recipeId, name: tag.name })
    .from(recipeTag)
    .innerJoin(tag, eq(tag.id, recipeTag.tagId))
    .where(inArray(recipeTag.recipeId, ids))
    .all();
  for (const tr of tagRows) {
    const list = tagsByRecipe.get(tr.recipeId) ?? [];
    list.push(tr.name);
    tagsByRecipe.set(tr.recipeId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    photoPath: r.photoPath,
    servings: r.servings,
    prepTimeMin: r.prepTimeMin,
    cookTimeMin: r.cookTimeMin,
    tags: (tagsByRecipe.get(r.id) ?? []).sort(),
  }));
}
