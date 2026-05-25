import { asc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  ingredient,
  shoppingItemStapleSource,
  stapleGroup,
  stapleGroupItem,
} from "../../db/schema.ts";
import { cleanupOrphanShoppingItems } from "../shopping/cleanup.ts";

export type StapleGroupErrorCode =
  | "duplicate_name"
  | "duplicate_ingredient"
  | "incomplete_amount"
  | "not_found";

export class StapleGroupError extends Error {
  code: StapleGroupErrorCode;
  status: number;
  constructor(code: StapleGroupErrorCode, message: string, status = 400) {
    super(message);
    this.name = "StapleGroupError";
    this.code = code;
    this.status = status;
  }
}

export type StapleGroupSummary = {
  id: number;
  name: string;
  sortOrder: number;
  itemCount: number;
};

export type StapleGroupItemDetail = {
  id: number;
  ingredientId: number;
  ingredientName: string;
  quantity: number | null;
  unitId: number | null;
  unitName: string | null;
  note: string | null;
  sortOrder: number;
};

export type StapleGroupDetail = {
  id: number;
  name: string;
  sortOrder: number;
  items: StapleGroupItemDetail[];
};

export type CreateGroupResult = {
  id: number;
  name: string;
  sortOrder: number;
};

export function createGroup(name: string): CreateGroupResult {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new StapleGroupError("duplicate_name", "Name darf nicht leer sein");
  }
  const existing = db
    .select({ id: stapleGroup.id })
    .from(stapleGroup)
    .where(eq(stapleGroup.name, trimmed))
    .get();
  if (existing) {
    throw new StapleGroupError("duplicate_name", "Name bereits vergeben", 409);
  }
  const maxSort =
    db
      .select({ max: sql<number | null>`MAX(${stapleGroup.sortOrder})` })
      .from(stapleGroup)
      .get()?.max ?? -1;
  const sortOrder = maxSort + 1;
  const inserted = db
    .insert(stapleGroup)
    .values({ name: trimmed, sortOrder })
    .returning({ id: stapleGroup.id })
    .all()[0];
  return { id: inserted.id, name: trimmed, sortOrder };
}

export function renameGroup(id: number, name: string): void {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new StapleGroupError("duplicate_name", "Name darf nicht leer sein");
  }
  const conflict = db
    .select({ id: stapleGroup.id })
    .from(stapleGroup)
    .where(eq(stapleGroup.name, trimmed))
    .get();
  if (conflict && conflict.id !== id) {
    throw new StapleGroupError("duplicate_name", "Name bereits vergeben", 409);
  }
  const result = db
    .update(stapleGroup)
    .set({ name: trimmed, updatedAt: sql`unixepoch()` })
    .where(eq(stapleGroup.id, id))
    .run();
  if (result.changes === 0) {
    throw new StapleGroupError("not_found", "Gruppe nicht gefunden", 404);
  }
}

export function listGroups(): StapleGroupSummary[] {
  const heads = db
    .select({
      id: stapleGroup.id,
      name: stapleGroup.name,
      sortOrder: stapleGroup.sortOrder,
    })
    .from(stapleGroup)
    .orderBy(asc(stapleGroup.sortOrder), asc(stapleGroup.name))
    .all();
  if (heads.length === 0) return [];
  const counts = db
    .select({
      groupId: stapleGroupItem.groupId,
      count: sql<number>`COUNT(*)`,
    })
    .from(stapleGroupItem)
    .groupBy(stapleGroupItem.groupId)
    .all();
  const byGroup = new Map(counts.map((c) => [c.groupId, Number(c.count)]));
  return heads.map((h) => ({ ...h, itemCount: byGroup.get(h.id) ?? 0 }));
}

export function getGroup(id: number): StapleGroupDetail | null {
  const head = db
    .select()
    .from(stapleGroup)
    .where(eq(stapleGroup.id, id))
    .get();
  if (!head) return null;
  const items = db
    .select({
      id: stapleGroupItem.id,
      ingredientId: stapleGroupItem.ingredientId,
      ingredientName: ingredient.name,
      quantity: stapleGroupItem.quantity,
      unitId: stapleGroupItem.unitId,
      unitName: sql<string | null>`(SELECT name FROM unit WHERE unit.id = ${stapleGroupItem.unitId})`,
      note: stapleGroupItem.note,
      sortOrder: stapleGroupItem.sortOrder,
    })
    .from(stapleGroupItem)
    .innerJoin(ingredient, eq(ingredient.id, stapleGroupItem.ingredientId))
    .where(eq(stapleGroupItem.groupId, id))
    .orderBy(asc(stapleGroupItem.sortOrder), asc(ingredient.name))
    .all();
  return {
    id: head.id,
    name: head.name,
    sortOrder: head.sortOrder,
    items,
  };
}

export function reorderGroups(orderedIds: number[]): void {
  db.transaction((tx) => {
    orderedIds.forEach((id, idx) => {
      tx.update(stapleGroup)
        .set({ sortOrder: idx, updatedAt: sql`unixepoch()` })
        .where(eq(stapleGroup.id, id))
        .run();
    });
  });
}

export type DeleteGroupResult = {
  shoppingItemsRemoved: number;
};

export function deleteGroup(id: number): DeleteGroupResult {
  return db.transaction((tx) => {
    // Capture which shopping items currently get a contribution from this
    // group BEFORE the cascade fires so the orphan-cleanup helper can re-check
    // them once the source rows are gone.
    const touched = tx
      .select({ itemId: shoppingItemStapleSource.itemId })
      .from(shoppingItemStapleSource)
      .where(eq(shoppingItemStapleSource.stapleGroupId, id))
      .all();
    const itemIds = Array.from(new Set(touched.map((r) => r.itemId)));
    const deleteResult = tx
      .delete(stapleGroup)
      .where(eq(stapleGroup.id, id))
      .run();
    if (deleteResult.changes === 0) {
      throw new StapleGroupError("not_found", "Gruppe nicht gefunden", 404);
    }
    const cleanup = cleanupOrphanShoppingItems(tx, itemIds);
    return { shoppingItemsRemoved: cleanup.itemsDeleted };
  });
}

export type AddGroupItemInput = {
  ingredientId: number;
  quantity?: number | null;
  unitId?: number | null;
  note?: string | null;
};

export type AddGroupItemResult = {
  id: number;
};

export function addGroupItem(
  groupId: number,
  input: AddGroupItemInput,
): AddGroupItemResult {
  validateAmount(input.quantity ?? null, input.unitId ?? null);
  const existing = db
    .select({ id: stapleGroupItem.id })
    .from(stapleGroupItem)
    .where(
      sql`${stapleGroupItem.groupId} = ${groupId} AND ${stapleGroupItem.ingredientId} = ${input.ingredientId}`,
    )
    .get();
  if (existing) {
    throw new StapleGroupError(
      "duplicate_ingredient",
      "Zutat ist bereits in dieser Gruppe",
      409,
    );
  }
  const maxSort =
    db
      .select({
        max: sql<number | null>`MAX(${stapleGroupItem.sortOrder})`,
      })
      .from(stapleGroupItem)
      .where(eq(stapleGroupItem.groupId, groupId))
      .get()?.max ?? -1;
  const inserted = db
    .insert(stapleGroupItem)
    .values({
      groupId,
      ingredientId: input.ingredientId,
      quantity: input.quantity ?? null,
      unitId: input.unitId ?? null,
      note: input.note ?? null,
      sortOrder: maxSort + 1,
    })
    .returning({ id: stapleGroupItem.id })
    .all()[0];
  return { id: inserted.id };
}

export type UpdateGroupItemInput = {
  ingredientId?: number;
  quantity?: number | null;
  unitId?: number | null;
  note?: string | null;
  sortOrder?: number;
};

export function updateGroupItem(
  itemId: number,
  input: UpdateGroupItemInput,
): void {
  const current = db
    .select()
    .from(stapleGroupItem)
    .where(eq(stapleGroupItem.id, itemId))
    .get();
  if (!current) {
    throw new StapleGroupError("not_found", "Eintrag nicht gefunden", 404);
  }
  if (
    input.ingredientId !== undefined &&
    input.ingredientId !== current.ingredientId
  ) {
    const collision = db
      .select({ id: stapleGroupItem.id })
      .from(stapleGroupItem)
      .where(
        sql`${stapleGroupItem.groupId} = ${current.groupId} AND ${stapleGroupItem.ingredientId} = ${input.ingredientId}`,
      )
      .get();
    if (collision && collision.id !== itemId) {
      throw new StapleGroupError(
        "duplicate_ingredient",
        "Zutat ist bereits in dieser Gruppe",
        409,
      );
    }
  }
  const nextQuantity =
    input.quantity === undefined ? current.quantity : input.quantity;
  const nextUnitId =
    input.unitId === undefined ? current.unitId : input.unitId;
  validateAmount(nextQuantity, nextUnitId);
  const patch: Partial<typeof stapleGroupItem.$inferInsert> = {};
  if (input.ingredientId !== undefined) patch.ingredientId = input.ingredientId;
  if (input.quantity !== undefined) patch.quantity = input.quantity;
  if (input.unitId !== undefined) patch.unitId = input.unitId;
  if (input.note !== undefined) patch.note = input.note;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (Object.keys(patch).length === 0) return;
  db.update(stapleGroupItem)
    .set(patch)
    .where(eq(stapleGroupItem.id, itemId))
    .run();
}

export function deleteGroupItem(itemId: number): void {
  const result = db
    .delete(stapleGroupItem)
    .where(eq(stapleGroupItem.id, itemId))
    .run();
  if (result.changes === 0) {
    throw new StapleGroupError("not_found", "Eintrag nicht gefunden", 404);
  }
}

function validateAmount(
  quantity: number | null,
  unitId: number | null,
): void {
  const hasQ = quantity != null;
  const hasU = unitId != null;
  if (hasQ !== hasU) {
    throw new StapleGroupError(
      "incomplete_amount",
      "Menge und Einheit müssen beide gesetzt oder beide leer sein",
    );
  }
}
