import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../../db/index.ts";
import {
  category,
  supermarket,
  supermarketCategory,
} from "../../../db/schema.ts";
import { getImpact } from "../shared/impact.ts";
import { runMerge, MergeError, type MergeResult } from "../shared/merge.ts";
import type { ImpactRow } from "../shared/types.ts";
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
};

export type SupermarketUpsertInput = {
  name: string;
  /** Ordered list of category IDs that should belong to this supermarket. */
  orderedCategoryIds: number[];
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
