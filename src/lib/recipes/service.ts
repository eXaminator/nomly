import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  recipe,
  recipeIngredient,
  recipeSection,
  recipeTag,
  tag,
  ingredient as ingredientTable,
  ingredientAlias as ingredientAliasTable,
  ingredientSubUnit as ingredientSubUnitTable,
  unit as unitTable,
} from "../../db/schema.ts";
import type { RecipeDiet } from "./diet.ts";
import type {
  RecipeInput,
  RecipeListItem,
  RecipeView,
} from "./types.ts";
import { deriveDiet, type IngredientDietaryClass } from "./diet.ts";
import { isOptionalIngredient } from "./optional.ts";
import { fold, matchRecipe, parseQuery } from "./search.ts";

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
 *
 * `defaultsByLowerName` (optional) carries per-name metadata the recipe form
 * collected for ingredients that don't exist yet — category, dietary class,
 * exclude flag. Applied only when inserting; ignored when resolving to an
 * existing row.
 */
function resolveIngredient(
  tx: Tx,
  rawName: string,
  defaultsByLowerName?: Map<string, NewIngredientDefaultsFromInput>,
): number {
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

  const defaults = defaultsByLowerName?.get(lowered);
  const inserted = tx
    .insert(ingredientTable)
    .values({
      name: cleaned,
      defaultCategoryId: defaults?.defaultCategoryId ?? null,
      dietaryClass: defaults?.dietaryClass ?? null,
      excludeFromShoppingList: defaults?.excludeFromShoppingList ?? false,
      isEquipment: defaults?.isEquipment ?? false,
    })
    .returning({ id: ingredientTable.id })
    .all();
  return inserted[0].id;
}

/**
 * Insert an alias of {@link ingredientId} with the given display name, but
 * only when no existing canonical or alias row already covers it (case-
 * insensitive, Unicode-aware). Used by the force-match flow on recipe save
 * — the user explicitly opted in by checking "Als Alias hinzufügen" in the
 * picker, so they accept a small catalog change.
 */
function addIngredientAlias(
  tx: Tx,
  ingredientId: number,
  aliasName: string,
): void {
  const cleaned = norm(aliasName);
  if (cleaned.length === 0) return;
  const lowered = cleaned.toLowerCase();
  const canonical = tx
    .select({ id: ingredientTable.id })
    .from(ingredientTable)
    .where(sql`lower_u(${ingredientTable.name}) = ${lowered}`)
    .get();
  if (canonical) return;
  const existingAlias = tx
    .select({ id: ingredientAliasTable.ingredientId })
    .from(ingredientAliasTable)
    .where(sql`lower_u(${ingredientAliasTable.name}) = ${lowered}`)
    .get();
  if (existingAlias) return;
  tx.insert(ingredientAliasTable)
    .values({ ingredientId, name: cleaned })
    .run();
}

function resolveDisplayUnit(
  tx: Tx,
  unitId: number | null,
  displayUnit: string | null,
): string | null {
  const trimmed = displayUnit?.trim() ?? "";
  if (trimmed.length === 0 || unitId == null) return null;
  const row = tx
    .select({ name: unitTable.name })
    .from(unitTable)
    .where(eq(unitTable.id, unitId))
    .get();
  if (row && row.name.toLowerCase() === trimmed.toLowerCase()) return null;
  return trimmed;
}

type NewIngredientDefaultsFromInput = {
  defaultCategoryId: number | null;
  dietaryClass: "vegan" | "vegetarian" | "meat" | null;
  excludeFromShoppingList: boolean;
  isEquipment: boolean;
};

function buildNewIngredientDefaultsMap(
  defaults: RecipeInput["newIngredientDefaults"],
): Map<string, NewIngredientDefaultsFromInput> {
  const map = new Map<string, NewIngredientDefaultsFromInput>();
  if (!defaults) return map;
  for (const d of defaults) {
    map.set(d.name.trim().toLowerCase(), {
      defaultCategoryId: d.defaultCategoryId,
      dietaryClass: d.dietaryClass,
      excludeFromShoppingList: d.excludeFromShoppingList,
      isEquipment: d.isEquipment,
    });
  }
  return map;
}

function writeSections(
  tx: Tx,
  recipeId: number,
  sections: RecipeInput["sections"],
  newIngredientDefaults?: RecipeInput["newIngredientDefaults"],
) {
  const defaultsByLowerName = buildNewIngredientDefaultsMap(
    newIngredientDefaults,
  );
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

    // Tracks the most recent primary insertion in this section. An
    // alternative (`ing.isAlternative === true`) links back to this id via
    // `alternative_for_id`. If an alternative appears with no preceding
    // primary in the same section it's defensively demoted to a primary —
    // we never reach into a previous section because the relationship is
    // section-scoped.
    let lastPrimaryRowId: number | null = null;

    section.ingredients.forEach((ing, iIdx) => {
      const trimmedName = ing.ingredientName.trim();
      // Explicit ingredient id from the pill picker wins over name-based
      // resolution. This is the path the new pill UI uses to keep a row's
      // `display_name` decoupled from canonical lookup ("tomatoes" linked
      // to canonical Tomate without name-equality games).
      const ingredientId =
        ing.ingredientId != null
          ? ing.ingredientId
          : resolveIngredient(tx, trimmedName, defaultsByLowerName);
      // Force-match alias add: when the user pinned the row to a specific
      // ingredient and asked to remember the spelling, insert it as an
      // alias too (idempotent — duplicates are guarded by the lookup).
      if (ing.ingredientId != null && ing.addAsAlias) {
        addIngredientAlias(tx, ing.ingredientId, trimmedName);
      }
      // Resolve the alternative linkage. Orphan alternatives (no preceding
      // primary) silently become primaries — easier than rejecting the
      // whole save when the form / importer is in a transient state.
      const isAlternative = ing.isAlternative === true && lastPrimaryRowId !== null;
      const inserted = tx
        .insert(recipeIngredient)
        .values({
          sectionId,
          ingredientId,
          // Preserve the exact name the user picked (canonical OR alias)
          // so it survives the round-trip on the recipe view + edit page.
          displayName: trimmedName,
          quantity: ing.quantity,
          unitId: ing.subUnitId != null ? null : ing.unitId,
          subUnitId: ing.subUnitId ?? null,
          // Same alias-preservation as displayName, but for units. Stored
          // only when it differs from the canonical unit name — keeps a
          // unit rename in Stammdaten flowing through to existing recipes.
          // Skipped when the row resolved to a sub-unit (whose name is the
          // source of truth on its own).
          displayUnit:
            ing.subUnitId != null
              ? null
              : resolveDisplayUnit(tx, ing.unitId, ing.displayUnit),
          notes: ing.notes,
          // Alternatives are always optional, regardless of what the
          // caller sent. Mirrors the parser's `forceOptional` invariant.
          isOptional: isAlternative ? true : ing.isOptional,
          fixedAmount: ing.fixedAmount,
          rawLine: ing.rawLine ?? null,
          sortOrder: iIdx,
          alternativeForId: isAlternative ? lastPrimaryRowId : null,
        })
        .returning({ id: recipeIngredient.id })
        .all();
      if (!isAlternative) {
        lastPrimaryRowId = inserted[0].id;
      }
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
    writeSections(tx, recipeId, input.sections, input.newIngredientDefaults);
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

    writeSections(tx, id, input.sections, input.newIngredientDefaults);
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
    subUnitId: number | null;
    subUnitPerPurchase: number | null;
    notes: string | null;
    isOptional: boolean;
    fixedAmount: boolean;
    rawLine: string | null;
    dietaryClass: IngredientDietaryClass;
    isEquipment: boolean;
    sortOrder: number;
    alternativeForId: number | null;
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
            // Render order: display_unit override → sub-unit name → canonical
            // unit name. Sub-units win over the unit join because the row
            // can't have both set anyway (the writer keeps unit_id NULL
            // whenever sub_unit_id is non-NULL).
            unitName: sql<
              string | null
            >`coalesce(${recipeIngredient.displayUnit}, ${ingredientSubUnitTable.name}, ${unitTable.name})`,
            subUnitId: recipeIngredient.subUnitId,
            subUnitPerPurchase: ingredientSubUnitTable.perPurchase,
            notes: recipeIngredient.notes,
            isOptional: recipeIngredient.isOptional,
            fixedAmount: recipeIngredient.fixedAmount,
            rawLine: recipeIngredient.rawLine,
            dietaryClass: ingredientTable.dietaryClass,
            isEquipment: ingredientTable.isEquipment,
            sortOrder: recipeIngredient.sortOrder,
            alternativeForId: recipeIngredient.alternativeForId,
          })
          .from(recipeIngredient)
          .leftJoin(unitTable, eq(unitTable.id, recipeIngredient.unitId))
          .leftJoin(
            ingredientSubUnitTable,
            eq(ingredientSubUnitTable.id, recipeIngredient.subUnitId),
          )
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
    ingredients
      .filter((i) => !isOptionalIngredient(i))
      .map((i) => i.dietaryClass),
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
    dietConfidence: diet.confidence,
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
          subUnitId: i.subUnitId,
          subUnitPerPurchase: i.subUnitPerPurchase,
          notes: i.notes,
          isOptional: i.isOptional,
          fixedAmount: i.fixedAmount,
          rawLine: i.rawLine,
          isEquipment: i.isEquipment,
          dietaryClass: i.dietaryClass,
          sortOrder: i.sortOrder,
          alternativeForId: i.alternativeForId,
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
  /** Diet filter. "vegetarian" includes definite+probable vegetarian (and
   *  vegan). "vegan" includes definite+probable vegan. Recipes whose diet
   *  is `unknown` are excluded for any non-empty filter. */
  diet?: "vegetarian" | "vegan";
};

/**
 * One folded `" "`-joined string per recipe containing canonical names +
 * all aliases for every non-optional ingredient. Used only when the
 * parsed query contains at least one `zutat:` token.
 */
function loadIngredientIndex(recipeIds: number[]): Map<number, string> {
  if (recipeIds.length === 0) return new Map();
  const rows = db
    .select({
      recipeId: recipeSection.recipeId,
      canonical: ingredientTable.name,
      alias: ingredientAliasTable.name,
    })
    .from(recipeIngredient)
    .innerJoin(recipeSection, eq(recipeSection.id, recipeIngredient.sectionId))
    .innerJoin(
      ingredientTable,
      eq(ingredientTable.id, recipeIngredient.ingredientId),
    )
    .leftJoin(
      ingredientAliasTable,
      eq(ingredientAliasTable.ingredientId, ingredientTable.id),
    )
    .where(
      and(
        inArray(recipeSection.recipeId, recipeIds),
        // "Counted" rows for the search-index: non-optional AND not an
        // alternative. Mirrors {@link isOptionalIngredient} on the SQL side.
        eq(recipeIngredient.isOptional, false),
        isNull(recipeIngredient.alternativeForId),
      ),
    )
    .all();
  const acc = new Map<number, Set<string>>();
  for (const row of rows) {
    const set = acc.get(row.recipeId) ?? new Set<string>();
    set.add(fold(row.canonical));
    if (row.alias) set.add(fold(row.alias));
    acc.set(row.recipeId, set);
  }
  const out = new Map<number, string>();
  for (const [rid, set] of acc) out.set(rid, Array.from(set).join(" "));
  return out;
}

export function listRecipes(opts: ListRecipesOptions = {}): RecipeListItem[] {
  const { query, mustTags = [], notTags = [], diet } = opts;

  const rows = db.select().from(recipe).all();
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

  const parsed = parseQuery(query ?? "");
  const needsIngredientIndex = parsed.tokens.some((t) => t.kind === "zutat");
  const ingredientIndex = needsIngredientIndex
    ? loadIngredientIndex(ids)
    : new Map<number, string>();

  const mustLower = mustTags.map((t) => t.toLowerCase());
  const notLower = notTags.map((t) => t.toLowerCase());

  type Scored = { row: (typeof rows)[number]; rank: number };
  const scored: Scored[] = [];

  for (const r of rows) {
    const recipeTags = (tagsByRecipe.get(r.id) ?? []).map((t) => t.toLowerCase());
    if (mustLower.length > 0 || notLower.length > 0) {
      const have = new Set(recipeTags);
      let pass = true;
      for (const m of mustLower) {
        if (!have.has(m)) {
          pass = false;
          break;
        }
      }
      if (!pass) continue;
      for (const n of notLower) {
        if (have.has(n)) {
          pass = false;
          break;
        }
      }
      if (!pass) continue;
    }
    const dietRow = dietByRecipe.get(r.id) ?? {
      isVegan: true,
      isVegetarian: true,
      confidence: "definite" as const,
    };
    if (diet === "vegetarian" && dietRow.isVegetarian !== true) continue;
    if (diet === "vegan" && dietRow.isVegan !== true) continue;

    const match = matchRecipe(parsed, {
      titleFolded: fold(r.title),
      ingredientsFolded: ingredientIndex.get(r.id) ?? "",
    });
    if (!match.passes) continue;
    scored.push({ row: r, rank: match.rank });
  }

  const queryActive = parsed.tokens.length > 0;
  scored.sort((a, b) => {
    if (queryActive && a.rank !== b.rank) return b.rank - a.rank;
    return a.row.title.localeCompare(b.row.title, "de");
  });

  return scored.map(({ row: r }) => {
    const recipeTags = (tagsByRecipe.get(r.id) ?? []).slice().sort();
    const dietRow = dietByRecipe.get(r.id) ?? {
      isVegan: true,
      isVegetarian: true,
      confidence: "definite" as const,
    };
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      photoPath: r.photoPath,
      servings: r.servings,
      prepTimeMin: r.prepTimeMin,
      cookTimeMin: r.cookTimeMin,
      tags: recipeTags,
      isVegan: dietRow.isVegan,
      isVegetarian: dietRow.isVegetarian,
      dietConfidence: dietRow.confidence,
    };
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
        // Diet calc counts non-optional, non-alternative rows only.
        eq(recipeIngredient.isOptional, false),
        isNull(recipeIngredient.alternativeForId),
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
