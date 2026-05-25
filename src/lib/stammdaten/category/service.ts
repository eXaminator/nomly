import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "../../../db/index.ts";
import {
  category,
  categoryAlias,
  ingredient,
  shoppingItem,
  supermarket,
  supermarketCategory,
} from "../../../db/schema.ts";
import { getImpact } from "../shared/impact.ts";
import { runMerge, MergeError, type MergeResult } from "../shared/merge.ts";
import type { ImpactRow } from "../shared/types.ts";
import {
  dedupeAliasesIgnoreCase,
  findNameCollision,
  normalizeName,
  validateName,
} from "../shared/validation.ts";
import { categoryAdapter, type CategoryRow } from "./adapter.ts";

export type CategoryListItem = {
  id: number;
  name: string;
  aliases: string[];
  usageCount: number;
};

export type CategoryUpsertInput = {
  name: string;
  aliases: string[];
};

export class CategoryStammdatenError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CategoryStammdatenError";
    this.status = status;
  }
}

function loadAliasesGrouped(ids: number[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  if (ids.length === 0) return out;
  const rows = db
    .select({ categoryId: categoryAlias.categoryId, name: categoryAlias.name })
    .from(categoryAlias)
    .where(inArray(categoryAlias.categoryId, ids))
    .orderBy(asc(categoryAlias.name))
    .all();
  for (const row of rows) {
    const list = out.get(row.categoryId) ?? [];
    list.push(row.name);
    out.set(row.categoryId, list);
  }
  return out;
}

function loadUsageCounts(ids: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, 0);

  function tally(rows: Array<{ id: number | null; count: number }>) {
    for (const r of rows) {
      if (r.id == null) continue;
      out.set(r.id, (out.get(r.id) ?? 0) + Number(r.count));
    }
  }

  tally(
    db
      .select({
        id: ingredient.defaultCategoryId,
        count: sql<number>`count(*)`,
      })
      .from(ingredient)
      .where(inArray(ingredient.defaultCategoryId, ids))
      .groupBy(ingredient.defaultCategoryId)
      .all(),
  );
  tally(
    db
      .select({
        id: shoppingItem.categoryId,
        count: sql<number>`count(*)`,
      })
      .from(shoppingItem)
      .where(inArray(shoppingItem.categoryId, ids))
      .groupBy(shoppingItem.categoryId)
      .all(),
  );
  tally(
    db
      .select({
        id: supermarketCategory.categoryId,
        count: sql<number>`count(*)`,
      })
      .from(supermarketCategory)
      .where(inArray(supermarketCategory.categoryId, ids))
      .groupBy(supermarketCategory.categoryId)
      .all(),
  );

  return out;
}

function loadCategoriesBase(query?: string) {
  if (!query || query.trim().length === 0) {
    return db
      .select({ id: category.id, name: category.name })
      .from(category)
      .orderBy(sql`unaccent(${category.name})`)
      .all();
  }
  const pattern = `%${query.trim().toLowerCase().replace(/[%_]/g, "\\$&")}%`;
  const aliasMatchIds = db
    .select({ id: categoryAlias.categoryId })
    .from(categoryAlias)
    .where(sql`lower_u(${categoryAlias.name}) LIKE ${pattern}`);
  return db
    .select({ id: category.id, name: category.name })
    .from(category)
    .where(
      or(
        sql`lower_u(${category.name}) LIKE ${pattern}`,
        inArray(category.id, aliasMatchIds),
      ),
    )
    .orderBy(sql`unaccent(${category.name})`)
    .all();
}

export function listCategories(query?: string): CategoryListItem[] {
  const base = loadCategoriesBase(query);
  const ids = base.map((r) => r.id);
  const aliases = loadAliasesGrouped(ids);
  const usage = loadUsageCounts(ids);
  return base.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: aliases.get(row.id) ?? [],
    usageCount: usage.get(row.id) ?? 0,
  }));
}

export function getCategoryDetail(id: number): CategoryListItem | null {
  const row = db
    .select({ id: category.id, name: category.name })
    .from(category)
    .where(eq(category.id, id))
    .get();
  if (!row) return null;
  const aliases = loadAliasesGrouped([id]);
  const usage = loadUsageCounts([id]);
  return {
    id: row.id,
    name: row.name,
    aliases: aliases.get(row.id) ?? [],
    usageCount: usage.get(row.id) ?? 0,
  };
}

function validateInput(
  input: CategoryUpsertInput,
  excludeId?: number,
): { name: string; aliases: string[] } {
  const nameError = validateName(input.name);
  if (nameError) throw new CategoryStammdatenError(nameError);
  const cleanedName = normalizeName(input.name);

  const aliasResult = dedupeAliasesIgnoreCase(input.aliases, cleanedName);
  if (aliasResult.error) throw new CategoryStammdatenError(aliasResult.error);
  const cleanedAliases = aliasResult.aliases;

  const nameCollision = findNameCollision({
    name: cleanedName,
    canonicalTable: category,
    canonicalIdColumn: category.id,
    canonicalNameColumn: category.name,
    aliasTable: categoryAlias,
    aliasParentColumn: categoryAlias.categoryId,
    aliasNameColumn: categoryAlias.name,
    excludeCanonicalId: excludeId,
    excludeAliasParentId: excludeId,
  });
  if (nameCollision) {
    throw new CategoryStammdatenError(
      `Der Name "${cleanedName}" ist bereits vergeben (${
        nameCollision.kind === "canonical" ? "als Kategorie" : "als Alias"
      }: "${nameCollision.name}").`,
      409,
    );
  }

  for (const alias of cleanedAliases) {
    const collision = findNameCollision({
      name: alias,
      canonicalTable: category,
      canonicalIdColumn: category.id,
      canonicalNameColumn: category.name,
      aliasTable: categoryAlias,
      aliasParentColumn: categoryAlias.categoryId,
      aliasNameColumn: categoryAlias.name,
      excludeCanonicalId: excludeId,
      excludeAliasParentId: excludeId,
    });
    if (collision) {
      throw new CategoryStammdatenError(
        `Alias "${alias}" ist bereits vergeben (${
          collision.kind === "canonical" ? "als Kategorie" : "als Alias"
        }: "${collision.name}").`,
        409,
      );
    }
  }

  return { name: cleanedName, aliases: cleanedAliases };
}

export function createCategory(input: CategoryUpsertInput): CategoryListItem {
  const { name, aliases } = validateInput(input);
  const id = db.transaction((tx) => {
    const inserted = tx
      .insert(category)
      .values({ name })
      .returning({ id: category.id })
      .all();
    const newId = inserted[0].id;
    if (aliases.length > 0) {
      tx.insert(categoryAlias)
        .values(aliases.map((n) => ({ categoryId: newId, name: n })))
        .run();
    }
    return newId;
  });
  return getCategoryDetail(id) ?? unreachable();
}

export function updateCategory(
  id: number,
  input: CategoryUpsertInput,
): CategoryListItem {
  const existing = db
    .select({ id: category.id })
    .from(category)
    .where(eq(category.id, id))
    .get();
  if (!existing) throw new CategoryStammdatenError("Kategorie nicht gefunden.", 404);

  const { name, aliases } = validateInput(input, id);
  db.transaction((tx) => {
    tx.update(category).set({ name }).where(eq(category.id, id)).run();
    tx.delete(categoryAlias).where(eq(categoryAlias.categoryId, id)).run();
    if (aliases.length > 0) {
      tx.insert(categoryAlias)
        .values(aliases.map((n) => ({ categoryId: id, name: n })))
        .run();
    }
  });
  return getCategoryDetail(id) ?? unreachable();
}

export type CategoryDeleteResult = { deletedId: number; replacedWith?: number };

export function deleteCategory(
  id: number,
  replaceWith?: number,
): CategoryDeleteResult {
  const existing = db
    .select({ id: category.id })
    .from(category)
    .where(eq(category.id, id))
    .get();
  if (!existing) throw new CategoryStammdatenError("Kategorie nicht gefunden.", 404);

  if (replaceWith != null) {
    if (replaceWith === id) {
      throw new CategoryStammdatenError(
        "Ersatz-Kategorie darf nicht die zu löschende Kategorie sein.",
      );
    }
    const target = db
      .select({ id: category.id })
      .from(category)
      .where(eq(category.id, replaceWith))
      .get();
    if (!target) {
      throw new CategoryStammdatenError("Ersatz-Kategorie nicht gefunden.", 404);
    }
    try {
      runMerge(replaceWith, [id], categoryAdapter);
    } catch (e) {
      if (e instanceof MergeError) {
        throw new CategoryStammdatenError(e.message, 409);
      }
      throw e;
    }
    return { deletedId: id, replacedWith: replaceWith };
  }

  // All FKs are set-null or cascade. Safe to delete directly; refs will null
  // out / cascade automatically.
  db.delete(category).where(eq(category.id, id)).run();
  return { deletedId: id };
}

export type CategoryBulkPatch = {
  /** Supermarkets to which each selected category is appended (skipped per
   *  pair if the link already exists). */
  addToSupermarketIds?: number[];
  /** Supermarkets from which each selected category is detached. */
  removeFromSupermarketIds?: number[];
};

export type CategoryBulkResult = {
  added: Array<{ categoryId: number; supermarketId: number }>;
  removed: Array<{ categoryId: number; supermarketId: number }>;
};

/**
 * For each (selected category, target supermarket) pair: append the category
 * at the end of that supermarket's order (or detach it). Mirrors
 * `bulkUpdateSupermarkets` but with the loop nested the other way around so
 * "set this category on N markets" is a single round-trip.
 */
export function bulkUpdateCategories(
  categoryIds: number[],
  patch: CategoryBulkPatch,
): CategoryBulkResult {
  const addIds = Array.from(new Set(patch.addToSupermarketIds ?? []));
  const removeIds = Array.from(new Set(patch.removeFromSupermarketIds ?? []));
  if (
    categoryIds.length === 0 ||
    (addIds.length === 0 && removeIds.length === 0)
  ) {
    return { added: [], removed: [] };
  }
  const allMarketIds = Array.from(new Set([...addIds, ...removeIds]));
  if (allMarketIds.length > 0) {
    const found = db
      .select({ id: supermarket.id })
      .from(supermarket)
      .where(inArray(supermarket.id, allMarketIds))
      .all();
    if (found.length !== allMarketIds.length) {
      const have = new Set(found.map((r) => r.id));
      const missing = allMarketIds.filter((id) => !have.has(id));
      throw new CategoryStammdatenError(
        `Unbekannte Supermärkte: ${missing.join(", ")}.`,
        404,
      );
    }
  }
  const added: Array<{ categoryId: number; supermarketId: number }> = [];
  const removed: Array<{ categoryId: number; supermarketId: number }> = [];

  db.transaction((tx) => {
    for (const supermarketId of addIds) {
      const existing = tx
        .select({ categoryId: supermarketCategory.categoryId })
        .from(supermarketCategory)
        .where(eq(supermarketCategory.supermarketId, supermarketId))
        .all();
      const taken = new Set(existing.map((r) => r.categoryId));
      const toInsert = categoryIds.filter((id) => !taken.has(id));
      if (toInsert.length === 0) continue;
      const maxRow = tx
        .select({
          max: sql<number | null>`MAX(${supermarketCategory.sortOrder})`,
        })
        .from(supermarketCategory)
        .where(eq(supermarketCategory.supermarketId, supermarketId))
        .get();
      let nextSort = (maxRow?.max ?? -1) + 1;
      tx.insert(supermarketCategory)
        .values(
          toInsert.map((categoryId) => ({
            supermarketId,
            categoryId,
            sortOrder: nextSort++,
          })),
        )
        .run();
      for (const categoryId of toInsert) added.push({ categoryId, supermarketId });
    }
    for (const supermarketId of removeIds) {
      const existing = tx
        .select({ categoryId: supermarketCategory.categoryId })
        .from(supermarketCategory)
        .where(
          and(
            eq(supermarketCategory.supermarketId, supermarketId),
            inArray(supermarketCategory.categoryId, categoryIds),
          ),
        )
        .all();
      if (existing.length === 0) continue;
      tx.delete(supermarketCategory)
        .where(
          and(
            eq(supermarketCategory.supermarketId, supermarketId),
            inArray(supermarketCategory.categoryId, categoryIds),
          ),
        )
        .run();
      for (const r of existing)
        removed.push({ categoryId: r.categoryId, supermarketId });
    }
  });
  return { added, removed };
}

export function mergeCategories(
  winnerId: number,
  loserIds: number[],
  options?: { replaceIds?: number[] },
): MergeResult<CategoryRow> {
  try {
    return runMerge(winnerId, loserIds, categoryAdapter, options);
  } catch (e) {
    if (e instanceof MergeError) throw new CategoryStammdatenError(e.message, 409);
    throw e;
  }
}

export function getImpactForCategories(ids: number[]): ImpactRow[] {
  return getImpact(ids, categoryAdapter);
}

function unreachable(): never {
  throw new Error("unreachable");
}
