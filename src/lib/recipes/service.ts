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
import type { RecipeDiet } from "./diet.ts";
import type {
  RecipeInput,
  RecipeListItem,
  RecipeView,
} from "./types.ts";
import { deriveDiet, type IngredientDietaryClass } from "./diet.ts";

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

  // Use `lower_u` (registered in src/db/index.ts) for Unicode-correct
  // case folding — SQLite's built-in LOWER is ASCII-only and would miss
  // existing rows like "Äpfel" / "Möhre" / "Soße".
  const canonical = tx
    .select({ id: ingredientTable.id })
    .from(ingredientTable)
    .where(sql`lower_u(${ingredientTable.name}) = ${lowered}`)
    .get();
  if (canonical) return canonical.id;

  const aliased = tx
    .select({ id: ingredientTable.id })
    .from(ingredientAliasTable)
    .innerJoin(
      ingredientTable,
      eq(ingredientTable.id, ingredientAliasTable.ingredientId),
    )
    .where(sql`lower_u(${ingredientAliasTable.name}) = ${lowered}`)
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
      const trimmedName = ing.ingredientName.trim();
      const ingredientId = resolveIngredient(tx, trimmedName);
      tx.insert(recipeIngredient)
        .values({
          sectionId,
          ingredientId,
          // Preserve the exact name the user picked (canonical OR alias)
          // so it survives the round-trip on the recipe view + edit page.
          displayName: trimmedName,
          quantity: ing.quantity,
          unitId: ing.unitId,
          notes: ing.notes,
          isOptional: ing.isOptional,
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
    canonicalIngredientName: string;
    quantity: number | null;
    unitId: number | null;
    unitName: string | null;
    notes: string | null;
    isOptional: boolean;
    dietaryClass: IngredientDietaryClass;
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
            // Display name: user's picked alias if set, otherwise the
            // canonical ingredient name.
            ingredientName: sql<string>`coalesce(${recipeIngredient.displayName}, ${ingredientTable.name})`,
            canonicalIngredientName: ingredientTable.name,
            quantity: recipeIngredient.quantity,
            unitId: recipeIngredient.unitId,
            unitName: unitTable.name,
            notes: recipeIngredient.notes,
            isOptional: recipeIngredient.isOptional,
            dietaryClass: ingredientTable.dietaryClass,
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

  const diet = deriveDiet(
    ingredients.filter((i) => !i.isOptional).map((i) => i.dietaryClass),
  );

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
    isVegan: diet.isVegan,
    isVegetarian: diet.isVegetarian,
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
          canonicalIngredientName: i.canonicalIngredientName,
          quantity: i.quantity,
          unitId: i.unitId,
          unitName: i.unitName,
          notes: i.notes,
          isOptional: i.isOptional,
          sortOrder: i.sortOrder,
        })),
    })),
    createdAt: head.createdAt,
    updatedAt: head.updatedAt,
  };
}

export type ListRecipesOptions = {
  query?: string;
  /** Recipe must carry every tag in this list. */
  mustTags?: string[];
  /** Recipe must carry none of the tags in this list. */
  notTags?: string[];
};

export function listRecipes(opts: ListRecipesOptions = {}): RecipeListItem[] {
  const { query, mustTags = [], notTags = [] } = opts;
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
  const dietByRecipe = computeDietForRecipes(ids);
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

  // Tag filtering happens in-memory against the already-joined tag map. Tag
  // names are compared case-insensitively (search hits already are).
  const mustLower = mustTags.map((t) => t.toLowerCase());
  const notLower = notTags.map((t) => t.toLowerCase());
  const passesTagFilter = (recipeTags: string[]): boolean => {
    if (mustLower.length === 0 && notLower.length === 0) return true;
    const have = new Set(recipeTags.map((t) => t.toLowerCase()));
    for (const m of mustLower) if (!have.has(m)) return false;
    for (const n of notLower) if (have.has(n)) return false;
    return true;
  };

  return rows.flatMap((r) => {
    const recipeTags = (tagsByRecipe.get(r.id) ?? []).sort();
    if (!passesTagFilter(recipeTags)) return [];
    const diet = dietByRecipe.get(r.id) ?? { isVegan: true, isVegetarian: true };
    return [
      {
        id: r.id,
        title: r.title,
        description: r.description,
        photoPath: r.photoPath,
        servings: r.servings,
        prepTimeMin: r.prepTimeMin,
        cookTimeMin: r.cookTimeMin,
        tags: recipeTags,
        isVegan: diet.isVegan,
        isVegetarian: diet.isVegetarian,
      },
    ];
  });
}

/**
 * Pull every non-optional (recipeId, dietary_class) pair for the given
 * recipes and derive recipe-level diet flags in JS. One query, no per-recipe
 * roundtrips. A recipe with no ingredients yields { vegan: true, vegetarian:
 * true } (vacuous truth) — the caller's default falls back to the same.
 */
function computeDietForRecipes(recipeIds: number[]): Map<number, RecipeDiet> {
  if (recipeIds.length === 0) return new Map();
  const rows = db
    .select({
      recipeId: recipeSection.recipeId,
      dietaryClass: ingredientTable.dietaryClass,
    })
    .from(recipeIngredient)
    .innerJoin(recipeSection, eq(recipeSection.id, recipeIngredient.sectionId))
    .innerJoin(
      ingredientTable,
      eq(ingredientTable.id, recipeIngredient.ingredientId),
    )
    .where(
      and(
        inArray(recipeSection.recipeId, recipeIds),
        eq(recipeIngredient.isOptional, false),
      ),
    )
    .all();

  const byRecipe = new Map<number, ("vegan" | "vegetarian" | "meat" | null)[]>();
  for (const row of rows) {
    const list = byRecipe.get(row.recipeId) ?? [];
    list.push(row.dietaryClass);
    byRecipe.set(row.recipeId, list);
  }
  const out = new Map<number, RecipeDiet>();
  for (const [recipeId, classes] of byRecipe) {
    out.set(recipeId, deriveDiet(classes));
  }
  return out;
}
