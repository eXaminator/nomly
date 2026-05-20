import { asc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "../../../db/index.ts";
import {
  category as categoryTable,
  product,
  productAlias,
  shoppingItem,
} from "../../../db/schema.ts";
import { getImpact } from "../shared/impact.ts";
import {
  findMergeClusters,
  type ProposalCluster,
} from "../shared/merge-proposals.ts";
import { runMerge, MergeError, type MergeResult } from "../shared/merge.ts";
import type { ImpactRow } from "../shared/types.ts";
import {
  dedupeAliasesIgnoreCase,
  findNameCollision,
  normalizeName,
  validateName,
} from "../shared/validation.ts";
import { productAdapter, type ProductRow } from "./adapter.ts";

export type ProductListItem = {
  id: number;
  name: string;
  aliases: string[];
  defaultCategoryId: number | null;
  defaultCategoryName: string | null;
  shoppingItemRefCount: number;
};

export type ProductUpsertInput = {
  name: string;
  aliases: string[];
  defaultCategoryId: number | null;
};

export class ProductStammdatenError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ProductStammdatenError";
    this.status = status;
  }
}

const nowSec = () => Math.floor(Date.now() / 1000);

function loadAliasesGrouped(ids: number[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  if (ids.length === 0) return out;
  const rows = db
    .select({
      productId: productAlias.productId,
      name: productAlias.name,
    })
    .from(productAlias)
    .where(inArray(productAlias.productId, ids))
    .orderBy(asc(productAlias.name))
    .all();
  for (const row of rows) {
    const list = out.get(row.productId) ?? [];
    list.push(row.name);
    out.set(row.productId, list);
  }
  return out;
}

function loadShoppingRefCounts(ids: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const rows = db
    .select({
      id: shoppingItem.productId,
      count: sql<number>`count(*)`,
    })
    .from(shoppingItem)
    .where(inArray(shoppingItem.productId, ids))
    .groupBy(shoppingItem.productId)
    .all();
  for (const row of rows) {
    if (row.id != null) out.set(row.id, Number(row.count));
  }
  return out;
}

function loadProductsBase(query?: string) {
  const base = db
    .select({
      id: product.id,
      name: product.name,
      defaultCategoryId: product.defaultCategoryId,
      defaultCategoryName: categoryTable.name,
    })
    .from(product)
    .leftJoin(categoryTable, eq(categoryTable.id, product.defaultCategoryId));

  if (!query || query.trim().length === 0) {
    return base.orderBy(sql`unaccent(${product.name})`).all();
  }
  const lowered = query.trim().toLowerCase();
  const pattern = `%${lowered.replace(/[%_]/g, "\\$&")}%`;
  const aliasMatchIds = db
    .select({ id: productAlias.productId })
    .from(productAlias)
    .where(sql`lower_u(${productAlias.name}) LIKE ${pattern}`);
  return base
    .where(
      or(
        sql`lower_u(${product.name}) LIKE ${pattern}`,
        inArray(product.id, aliasMatchIds),
      ),
    )
    .orderBy(sql`unaccent(${product.name})`)
    .all();
}

export function listProducts(query?: string): ProductListItem[] {
  const rows = loadProductsBase(query);
  const ids = rows.map((r) => r.id);
  const aliases = loadAliasesGrouped(ids);
  const refs = loadShoppingRefCounts(ids);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: aliases.get(row.id) ?? [],
    defaultCategoryId: row.defaultCategoryId,
    defaultCategoryName: row.defaultCategoryName,
    shoppingItemRefCount: refs.get(row.id) ?? 0,
  }));
}

export function getProductDetail(id: number): ProductListItem | null {
  const rows = db
    .select({
      id: product.id,
      name: product.name,
      defaultCategoryId: product.defaultCategoryId,
      defaultCategoryName: categoryTable.name,
    })
    .from(product)
    .leftJoin(categoryTable, eq(categoryTable.id, product.defaultCategoryId))
    .where(eq(product.id, id))
    .all();
  if (rows.length === 0) return null;
  const aliases = loadAliasesGrouped([id]);
  const refs = loadShoppingRefCounts([id]);
  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    aliases: aliases.get(row.id) ?? [],
    defaultCategoryId: row.defaultCategoryId,
    defaultCategoryName: row.defaultCategoryName,
    shoppingItemRefCount: refs.get(row.id) ?? 0,
  };
}

function validateInput(
  input: ProductUpsertInput,
  excludeId?: number,
): { name: string; aliases: string[] } {
  const nameError = validateName(input.name);
  if (nameError) throw new ProductStammdatenError(nameError);
  const cleanedName = normalizeName(input.name);

  const aliasResult = dedupeAliasesIgnoreCase(input.aliases, cleanedName);
  if (aliasResult.error) throw new ProductStammdatenError(aliasResult.error);
  const cleanedAliases = aliasResult.aliases;

  const nameCollision = findNameCollision({
    name: cleanedName,
    canonicalTable: product,
    canonicalIdColumn: product.id,
    canonicalNameColumn: product.name,
    aliasTable: productAlias,
    aliasParentColumn: productAlias.productId,
    aliasNameColumn: productAlias.name,
    excludeCanonicalId: excludeId,
    excludeAliasParentId: excludeId,
  });
  if (nameCollision) {
    throw new ProductStammdatenError(
      `Der Name "${cleanedName}" ist bereits vergeben (${
        nameCollision.kind === "canonical" ? "als Produkt" : "als Alias"
      }: "${nameCollision.name}").`,
      409,
    );
  }

  for (const alias of cleanedAliases) {
    const collision = findNameCollision({
      name: alias,
      canonicalTable: product,
      canonicalIdColumn: product.id,
      canonicalNameColumn: product.name,
      aliasTable: productAlias,
      aliasParentColumn: productAlias.productId,
      aliasNameColumn: productAlias.name,
      excludeCanonicalId: excludeId,
      excludeAliasParentId: excludeId,
    });
    if (collision) {
      throw new ProductStammdatenError(
        `Alias "${alias}" ist bereits vergeben (${
          collision.kind === "canonical" ? "als Produkt" : "als Alias"
        }: "${collision.name}").`,
        409,
      );
    }
  }

  return { name: cleanedName, aliases: cleanedAliases };
}

export function createProduct(input: ProductUpsertInput): ProductListItem {
  const { name, aliases } = validateInput(input);
  const id = db.transaction((tx) => {
    const inserted = tx
      .insert(product)
      .values({
        name,
        defaultCategoryId: input.defaultCategoryId ?? null,
      })
      .returning({ id: product.id })
      .all();
    const newId = inserted[0].id;
    if (aliases.length > 0) {
      tx.insert(productAlias)
        .values(aliases.map((name) => ({ productId: newId, name })))
        .run();
    }
    return newId;
  });
  return getProductDetail(id) ?? unreachable();
}

export function updateProduct(
  id: number,
  input: ProductUpsertInput,
): ProductListItem {
  const existing = db
    .select({ id: product.id })
    .from(product)
    .where(eq(product.id, id))
    .get();
  if (!existing) throw new ProductStammdatenError("Produkt nicht gefunden.", 404);

  const { name, aliases } = validateInput(input, id);
  db.transaction((tx) => {
    tx.update(product)
      .set({
        name,
        defaultCategoryId: input.defaultCategoryId ?? null,
        updatedAt: nowSec(),
      })
      .where(eq(product.id, id))
      .run();
    tx.delete(productAlias).where(eq(productAlias.productId, id)).run();
    if (aliases.length > 0) {
      tx.insert(productAlias)
        .values(aliases.map((name) => ({ productId: id, name })))
        .run();
    }
  });
  return getProductDetail(id) ?? unreachable();
}

export type ProductDeleteResult = { deletedId: number; replacedWith?: number };

export function deleteProduct(
  id: number,
  replaceWith?: number,
): ProductDeleteResult {
  const existing = db
    .select({ id: product.id })
    .from(product)
    .where(eq(product.id, id))
    .get();
  if (!existing) throw new ProductStammdatenError("Produkt nicht gefunden.", 404);

  if (replaceWith != null) {
    if (replaceWith === id) {
      throw new ProductStammdatenError(
        "Ersatz-Produkt darf nicht das zu löschende Produkt sein.",
      );
    }
    const target = db
      .select({ id: product.id })
      .from(product)
      .where(eq(product.id, replaceWith))
      .get();
    if (!target) {
      throw new ProductStammdatenError("Ersatz-Produkt nicht gefunden.", 404);
    }
    try {
      runMerge(replaceWith, [id], productAdapter);
    } catch (e) {
      if (e instanceof MergeError) {
        throw new ProductStammdatenError(e.message, 409);
      }
      throw e;
    }
    return { deletedId: id, replacedWith: replaceWith };
  }

  const impact = getImpactForProducts([id]);
  const refs = impact[0]?.refs ?? {};
  if ((refs.shoppingItems ?? 0) > 0) {
    throw new ProductStammdatenError(
      `Produkt wird in ${refs.shoppingItems} Einkaufslisten-Einträgen verwendet. Bitte ein Ersatz-Produkt angeben.`,
      409,
    );
  }

  db.delete(product).where(eq(product.id, id)).run();
  return { deletedId: id };
}

export function mergeProducts(
  winnerId: number,
  loserIds: number[],
  options?: { replaceIds?: number[] },
): MergeResult<ProductRow> {
  try {
    return runMerge(winnerId, loserIds, productAdapter, options);
  } catch (e) {
    if (e instanceof MergeError) throw new ProductStammdatenError(e.message, 409);
    throw e;
  }
}

export function getImpactForProducts(ids: number[]): ImpactRow[] {
  return getImpact(ids, productAdapter);
}

export function getMergeProposalsForProducts(): ProposalCluster[] {
  const list = listProducts();
  return findMergeClusters(
    list.map((item) => ({
      id: item.id,
      name: item.name,
      aliases: item.aliases,
      refCount: item.shoppingItemRefCount,
    })),
  );
}

function unreachable(): never {
  throw new Error("unreachable");
}
