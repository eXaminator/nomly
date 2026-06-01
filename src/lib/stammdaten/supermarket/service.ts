import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../../db/index.ts";
import {
  category,
  ingredient,
  ingredientSupermarketUnavailable,
  supermarket,
  supermarketCategory,
} from "../../../db/schema.ts";
import { getImpact } from "../shared/impact.ts";
import { runMerge, MergeError, type MergeResult } from "../shared/merge.ts";
import type { ImpactRow, Tx } from "../shared/types.ts";
import { normalizeName, validateName } from "../shared/validation.ts";
import { supermarketAdapter, type SupermarketRow } from "./adapter.ts";

export type SupermarketCategoryEntry = {
  id: number;
  categoryId: number;
  categoryName: string;
  sortOrder: number;
};

export type SupermarketListItem = {
  id: number;
  name: string;
  orderedCategoryCount: number;
};

export type SupermarketDetail = SupermarketListItem & {
  orderedCategories: SupermarketCategoryEntry[];
  /** Articles not carried at this supermarket (`ingredient_supermarket_
   *  unavailable`). The mirror of an ingredient's `excludedSupermarkets`. */
  unavailableArticles: Array<{ id: number; name: string }>;
};

export type SupermarketUpsertInput = {
  name: string;
  /** Ordered list of category IDs that should belong to this supermarket. */
  orderedCategoryIds: number[];
  /** Articles to mark unavailable at this supermarket. Replaces the full set of
   *  `ingredient_supermarket_unavailable` rows for this supermarket. Omitted =
   *  leave unchanged on update / none on create. */
  unavailableIngredientIds?: number[];
};

export class SupermarketStammdatenError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "SupermarketStammdatenError";
    this.status = status;
  }
}

function loadOrderedCounts(ids: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const rows = db
    .select({
      id: supermarketCategory.supermarketId,
      count: sql<number>`count(*)`,
    })
    .from(supermarketCategory)
    .where(inArray(supermarketCategory.supermarketId, ids))
    .groupBy(supermarketCategory.supermarketId)
    .all();
  for (const row of rows) out.set(row.id, Number(row.count));
  return out;
}

function loadOrderedCategories(
  supermarketId: number,
): SupermarketCategoryEntry[] {
  return db
    .select({
      id: supermarketCategory.id,
      categoryId: supermarketCategory.categoryId,
      categoryName: category.name,
      sortOrder: supermarketCategory.sortOrder,
    })
    .from(supermarketCategory)
    .innerJoin(category, eq(category.id, supermarketCategory.categoryId))
    .where(eq(supermarketCategory.supermarketId, supermarketId))
    .orderBy(asc(supermarketCategory.sortOrder), sql`unaccent(${category.name})`)
    .all();
}

function loadUnavailableArticles(
  supermarketId: number,
): Array<{ id: number; name: string }> {
  return db
    .select({ id: ingredient.id, name: ingredient.name })
    .from(ingredientSupermarketUnavailable)
    .innerJoin(
      ingredient,
      eq(ingredient.id, ingredientSupermarketUnavailable.ingredientId),
    )
    .where(eq(ingredientSupermarketUnavailable.supermarketId, supermarketId))
    .orderBy(sql`unaccent(${ingredient.name})`)
    .all();
}

/**
 * Replace the supermarket's unavailable-article rows with the supplied set.
 * De-dupes the ids and validates that each ingredient exists (an unknown id
 * would otherwise surface as a raw FK 500). delete-all-then-insert, so the
 * passed list becomes the new complete set.
 */
function writeUnavailableArticles(
  tx: Tx,
  supermarketId: number,
  ingredientIds: number[],
): void {
  tx.delete(ingredientSupermarketUnavailable)
    .where(eq(ingredientSupermarketUnavailable.supermarketId, supermarketId))
    .run();
  const ids = Array.from(new Set(ingredientIds));
  if (ids.length === 0) return;
  const found = tx
    .select({ id: ingredient.id })
    .from(ingredient)
    .where(inArray(ingredient.id, ids))
    .all();
  if (found.length !== ids.length) {
    const have = new Set(found.map((r) => r.id));
    const missing = ids.filter((id) => !have.has(id));
    throw new SupermarketStammdatenError(
      `Unbekannte Artikel: ${missing.join(", ")}.`,
      404,
    );
  }
  tx.insert(ingredientSupermarketUnavailable)
    .values(ids.map((ingredientId) => ({ ingredientId, supermarketId })))
    .run();
}

export function listSupermarkets(query?: string): SupermarketListItem[] {
  const base =
    !query || query.trim().length === 0
      ? db
          .select({ id: supermarket.id, name: supermarket.name })
          .from(supermarket)
          .orderBy(sql`unaccent(${supermarket.name})`)
          .all()
      : (() => {
          const pattern = `%${query.trim().toLowerCase().replace(/[%_]/g, "\\$&")}%`;
          return db
            .select({ id: supermarket.id, name: supermarket.name })
            .from(supermarket)
            .where(sql`lower_u(${supermarket.name}) LIKE ${pattern}`)
            .orderBy(sql`unaccent(${supermarket.name})`)
            .all();
        })();
  const ids = base.map((r) => r.id);
  const counts = loadOrderedCounts(ids);
  return base.map((row) => ({
    id: row.id,
    name: row.name,
    orderedCategoryCount: counts.get(row.id) ?? 0,
  }));
}

export function getSupermarketDetail(id: number): SupermarketDetail | null {
  const row = db
    .select({ id: supermarket.id, name: supermarket.name })
    .from(supermarket)
    .where(eq(supermarket.id, id))
    .get();
  if (!row) return null;
  const orderedCategories = loadOrderedCategories(id);
  return {
    id: row.id,
    name: row.name,
    orderedCategoryCount: orderedCategories.length,
    orderedCategories,
    unavailableArticles: loadUnavailableArticles(id),
  };
}

function validateName0(input: { name: string }, excludeId?: number): string {
  const nameError = validateName(input.name);
  if (nameError) throw new SupermarketStammdatenError(nameError);
  const cleaned = normalizeName(input.name);
  const lowered = cleaned.toLowerCase();
  const where = excludeId
    ? and(
        sql`lower_u(${supermarket.name}) = ${lowered}`,
        sql`${supermarket.id} != ${excludeId}`,
      )
    : sql`lower_u(${supermarket.name}) = ${lowered}`;
  const collision = db
    .select({ name: supermarket.name })
    .from(supermarket)
    .where(where)
    .get();
  if (collision) {
    throw new SupermarketStammdatenError(
      `Der Supermarkt "${collision.name}" existiert bereits.`,
      409,
    );
  }
  return cleaned;
}

function validateOrderedCategoryIds(ids: number[]): number[] {
  const dedup = Array.from(new Set(ids));
  if (dedup.length !== ids.length) {
    throw new SupermarketStammdatenError(
      "Kategorienreihenfolge enthält Duplikate.",
    );
  }
  if (dedup.length === 0) return dedup;
  const found = db
    .select({ id: category.id })
    .from(category)
    .where(inArray(category.id, dedup))
    .all();
  if (found.length !== dedup.length) {
    const foundSet = new Set(found.map((r) => r.id));
    const missing = dedup.filter((id) => !foundSet.has(id));
    throw new SupermarketStammdatenError(
      `Unbekannte Kategorien: ${missing.join(", ")}.`,
      404,
    );
  }
  return dedup;
}

export function createSupermarket(
  input: SupermarketUpsertInput,
): SupermarketDetail {
  const name = validateName0({ name: input.name });
  const orderedCategoryIds = validateOrderedCategoryIds(input.orderedCategoryIds);

  const id = db.transaction((tx) => {
    const inserted = tx
      .insert(supermarket)
      .values({ name })
      .returning({ id: supermarket.id })
      .all();
    const newId = inserted[0].id;
    if (orderedCategoryIds.length > 0) {
      tx.insert(supermarketCategory)
        .values(
          orderedCategoryIds.map((catId, idx) => ({
            supermarketId: newId,
            categoryId: catId,
            sortOrder: idx,
          })),
        )
        .run();
    }
    writeUnavailableArticles(tx, newId, input.unavailableIngredientIds ?? []);
    return newId;
  });
  return getSupermarketDetail(id) ?? unreachable();
}

export function updateSupermarket(
  id: number,
  input: SupermarketUpsertInput,
): SupermarketDetail {
  const existing = db
    .select({ id: supermarket.id })
    .from(supermarket)
    .where(eq(supermarket.id, id))
    .get();
  if (!existing)
    throw new SupermarketStammdatenError("Supermarkt nicht gefunden.", 404);

  const name = validateName0({ name: input.name }, id);
  const orderedCategoryIds = validateOrderedCategoryIds(input.orderedCategoryIds);

  db.transaction((tx) => {
    tx.update(supermarket).set({ name }).where(eq(supermarket.id, id)).run();
    tx.delete(supermarketCategory)
      .where(eq(supermarketCategory.supermarketId, id))
      .run();
    if (orderedCategoryIds.length > 0) {
      tx.insert(supermarketCategory)
        .values(
          orderedCategoryIds.map((catId, idx) => ({
            supermarketId: id,
            categoryId: catId,
            sortOrder: idx,
          })),
        )
        .run();
    }
    // Only touch exclusions when the caller supplied them — an omitted field
    // leaves the existing rows alone.
    if (input.unavailableIngredientIds !== undefined) {
      writeUnavailableArticles(tx, id, input.unavailableIngredientIds);
    }
  });
  return getSupermarketDetail(id) ?? unreachable();
}

export type SupermarketDeleteResult = {
  deletedId: number;
  replacedWith?: number;
};

export function deleteSupermarket(
  id: number,
  replaceWith?: number,
): SupermarketDeleteResult {
  const existing = db
    .select({ id: supermarket.id })
    .from(supermarket)
    .where(eq(supermarket.id, id))
    .get();
  if (!existing)
    throw new SupermarketStammdatenError("Supermarkt nicht gefunden.", 404);

  if (replaceWith != null) {
    if (replaceWith === id) {
      throw new SupermarketStammdatenError(
        "Ersatz-Supermarkt darf nicht der zu löschende Supermarkt sein.",
      );
    }
    const target = db
      .select({ id: supermarket.id })
      .from(supermarket)
      .where(eq(supermarket.id, replaceWith))
      .get();
    if (!target)
      throw new SupermarketStammdatenError(
        "Ersatz-Supermarkt nicht gefunden.",
        404,
      );
    try {
      runMerge(replaceWith, [id], supermarketAdapter);
    } catch (e) {
      if (e instanceof MergeError)
        throw new SupermarketStammdatenError(e.message, 409);
      throw e;
    }
    return { deletedId: id, replacedWith: replaceWith };
  }

  // supermarket_category cascades on supermarket delete.
  db.delete(supermarket).where(eq(supermarket.id, id)).run();
  return { deletedId: id };
}

export type SupermarketBulkPatch = {
  /** Category IDs to append at the end of each selected supermarket's order
   *  (skipped per-supermarket if already linked). */
  addCategoryIds?: number[];
  /** Category IDs to detach from each selected supermarket. */
  removeCategoryIds?: number[];
};

export type SupermarketBulkResult = {
  /** Per-supermarket count of new (supermarket, category) rows. */
  added: Array<{ supermarketId: number; count: number }>;
  /** Per-supermarket count of removed rows. */
  removed: Array<{ supermarketId: number; count: number }>;
};

/**
 * For each selected supermarket: optionally append a set of categories at the
 * end of its ordered list (de-duplicated against existing links), and/or
 * remove a set of category links. Validates that the referenced categories
 * exist; raises 404 otherwise.
 */
export function bulkUpdateSupermarkets(
  ids: number[],
  patch: SupermarketBulkPatch,
): SupermarketBulkResult {
  const addIds = Array.from(new Set(patch.addCategoryIds ?? []));
  const removeIds = Array.from(new Set(patch.removeCategoryIds ?? []));
  if (ids.length === 0 || (addIds.length === 0 && removeIds.length === 0)) {
    return { added: [], removed: [] };
  }
  const allCatIds = Array.from(new Set([...addIds, ...removeIds]));
  if (allCatIds.length > 0) {
    const found = db
      .select({ id: category.id })
      .from(category)
      .where(inArray(category.id, allCatIds))
      .all();
    if (found.length !== allCatIds.length) {
      const have = new Set(found.map((r) => r.id));
      const missing = allCatIds.filter((id) => !have.has(id));
      throw new SupermarketStammdatenError(
        `Unbekannte Kategorien: ${missing.join(", ")}.`,
        404,
      );
    }
  }
  const added: Array<{ supermarketId: number; count: number }> = [];
  const removed: Array<{ supermarketId: number; count: number }> = [];

  db.transaction((tx) => {
    for (const supermarketId of ids) {
      const exists = tx
        .select({ id: supermarket.id })
        .from(supermarket)
        .where(eq(supermarket.id, supermarketId))
        .get();
      if (!exists) continue;
      let removedCount = 0;
      if (removeIds.length > 0) {
        const r = tx
          .delete(supermarketCategory)
          .where(
            and(
              eq(supermarketCategory.supermarketId, supermarketId),
              inArray(supermarketCategory.categoryId, removeIds),
            ),
          )
          .run();
        removedCount = Number(r.changes ?? 0);
      }
      let addedCount = 0;
      if (addIds.length > 0) {
        const existing = tx
          .select({ categoryId: supermarketCategory.categoryId })
          .from(supermarketCategory)
          .where(eq(supermarketCategory.supermarketId, supermarketId))
          .all();
        const taken = new Set(existing.map((r) => r.categoryId));
        const toInsert = addIds.filter((id) => !taken.has(id));
        if (toInsert.length > 0) {
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
          addedCount = toInsert.length;
        }
      }
      if (addedCount > 0) added.push({ supermarketId, count: addedCount });
      if (removedCount > 0)
        removed.push({ supermarketId, count: removedCount });
    }
  });
  return { added, removed };
}

export function mergeSupermarkets(
  winnerId: number,
  loserIds: number[],
  options?: { replaceIds?: number[] },
): MergeResult<SupermarketRow> {
  try {
    return runMerge(winnerId, loserIds, supermarketAdapter, options);
  } catch (e) {
    if (e instanceof MergeError)
      throw new SupermarketStammdatenError(e.message, 409);
    throw e;
  }
}

export function getImpactForSupermarkets(ids: number[]): ImpactRow[] {
  return getImpact(ids, supermarketAdapter);
}

function unreachable(): never {
  throw new Error("unreachable");
}
