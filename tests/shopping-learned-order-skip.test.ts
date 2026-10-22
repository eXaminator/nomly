import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-learned-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

type Ctx = {
  storeId: number;
  otherStoreId: number;
  itemIds: number[];
  ingredientIds: number[];
};

async function seed(): Promise<Ctx> {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");
  db.delete(s.shoppingItemSkip).run();
  db.delete(s.ingredientPurchase).run();
  db.delete(s.shoppingItem).run();
  db.delete(s.ingredient).run();
  db.delete(s.supermarket).run();

  const [store, other] = db
    .insert(s.supermarket)
    .values([{ name: "Edeka" }, { name: "Aldi" }])
    .returning({ id: s.supermarket.id })
    .all();
  const ingredients = db
    .insert(s.ingredient)
    .values([{ name: "Milch" }, { name: "Brot" }, { name: "Apfel" }])
    .returning({ id: s.ingredient.id })
    .all();
  const items = db
    .insert(s.shoppingItem)
    // Old updatedAt so client-stamped toggles pass the last-write-wins gate.
    .values(ingredients.map((i) => ({ ingredientId: i.id, updatedAt: 0 })))
    .returning({ id: s.shoppingItem.id })
    .all();
  return {
    storeId: store.id,
    otherStoreId: other.id,
    itemIds: items.map((i) => i.id),
    ingredientIds: ingredients.map((i) => i.id),
  };
}

async function purchases() {
  const { db } = await import("@/db");
  const { ingredientPurchase } = await import("@/db/schema");
  return db.select().from(ingredientPurchase).all();
}

describe("check-off records the active store", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("stores the supermarket on the purchase a check creates", async () => {
    const { patchItem } = await import("@/lib/shopping/items");
    patchItem(ctx.itemIds[0], { checked: true }, { supermarketId: ctx.storeId });
    patchItem(ctx.itemIds[1], { checked: true });
    const rows = await purchases();
    const byItem = new Map(rows.map((r) => [r.shoppingItemId, r.supermarketId]));
    expect(byItem.get(ctx.itemIds[0])).toBe(ctx.storeId);
    expect(byItem.get(ctx.itemIds[1])).toBeNull();
  });

  it("drops an unknown store to null instead of failing the check", async () => {
    const { patchItem } = await import("@/lib/shopping/items");
    const view = patchItem(ctx.itemIds[0], { checked: true }, { supermarketId: 999_999 });
    expect(view.checked).toBe(true);
    expect((await purchases())[0].supermarketId).toBeNull();
  });

  it("retracts the purchase on uncheck", async () => {
    const { patchItem } = await import("@/lib/shopping/items");
    patchItem(ctx.itemIds[0], { checked: true }, { supermarketId: ctx.storeId });
    patchItem(ctx.itemIds[0], { checked: false });
    expect(await purchases()).toEqual([]);
  });

  it("keeps the purchase but clears its store when the store is deleted", async () => {
    const { patchItem } = await import("@/lib/shopping/items");
    const { db } = await import("@/db");
    const { supermarket } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    patchItem(ctx.itemIds[0], { checked: true }, { supermarketId: ctx.storeId });
    db.delete(supermarket).where(eq(supermarket.id, ctx.storeId)).run();
    const rows = await purchases();
    expect(rows).toHaveLength(1);
    expect(rows[0].supermarketId).toBeNull();
  });

  it("keeps the purchase (and the learned order) when a checked item is re-added", async () => {
    const { patchItem, addManualItem } = await import("@/lib/shopping/items");
    const { loadLearnedOrders } = await import("@/lib/shopping/learned-order-db");
    const t0 = Date.now() - 10 * 60 * 1000;
    ctx.itemIds.forEach((id, i) =>
      patchItem(id, { checked: true }, { supermarketId: ctx.storeId, clientStampedAt: t0 + i * 60_000 }),
    );
    // Same ingredients back on the list within the grace window → the rows
    // are reactivated, not recreated.
    for (const ingredientId of ctx.ingredientIds) {
      expect(addManualItem({ ingredientId }).action).toBe("reactivated");
    }
    const rows = await purchases();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.shoppingItemId == null)).toBe(true);
    expect(loadLearnedOrders().get(ctx.storeId)?.ingredients).toHaveLength(3);

    // The next check is a purchase of its own; un-checking it only retracts
    // that one, never the detached history.
    patchItem(ctx.itemIds[0], { checked: true }, { supermarketId: ctx.storeId });
    expect(await purchases()).toHaveLength(4);
    patchItem(ctx.itemIds[0], { checked: false });
    expect(await purchases()).toHaveLength(3);
  });

  it("checks off without a purchase when told so", async () => {
    const { patchItem } = await import("@/lib/shopping/items");
    const view = patchItem(
      ctx.itemIds[0],
      { checked: true },
      { supermarketId: ctx.storeId, countAsPurchase: false },
    );
    expect(view.checked).toBe(true);
    expect(await purchases()).toEqual([]);
    // Un-checking and checking normally afterwards records as usual.
    patchItem(ctx.itemIds[0], { checked: false });
    patchItem(ctx.itemIds[0], { checked: true }, { supermarketId: ctx.storeId });
    expect(await purchases()).toHaveLength(1);
  });

  it("learns the check-off sequence per store", async () => {
    const { patchItem } = await import("@/lib/shopping/items");
    const { loadLearnedOrders } = await import("@/lib/shopping/learned-order-db");
    const t0 = Date.now() - 10 * 60 * 1000;
    // Apfel, Milch, Brot — in that order, a minute apart, at Edeka.
    const sequence = [ctx.itemIds[2], ctx.itemIds[0], ctx.itemIds[1]];
    sequence.forEach((id, i) =>
      patchItem(
        id,
        { checked: true },
        { supermarketId: ctx.storeId, clientStampedAt: t0 + i * 60_000 },
      ),
    );
    const orders = loadLearnedOrders();
    expect(orders.has(ctx.otherStoreId)).toBe(false);
    const order = orders.get(ctx.storeId)!;
    const ranked = [...order.ingredients]
      .sort((a, b) => a.score - b.score)
      .map((e) => e.ingredientId);
    expect(ranked).toEqual([ctx.ingredientIds[2], ctx.ingredientIds[0], ctx.ingredientIds[1]]);
  });
});

describe("skip today", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("marks, re-marks and lifts a skip, exposed on the item view", async () => {
    const { markSkipped, unmarkSkipped } = await import("@/lib/shopping/skip");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    const id = ctx.itemIds[0];
    expect(markSkipped(id, ctx.storeId, "2026-10-21")).toBe("ok");
    expect(markSkipped(id, ctx.storeId, "2026-10-22")).toBe("ok");
    const view = () => listShoppingItems({ skipSweep: true }).find((i) => i.id === id)!;
    expect(view().skippedAt).toEqual([{ supermarketId: ctx.storeId, on: "2026-10-22" }]);
    unmarkSkipped(id, ctx.storeId);
    expect(view().skippedAt).toEqual([]);
  });

  it("reports unknown items and stores", async () => {
    const { markSkipped } = await import("@/lib/shopping/skip");
    expect(markSkipped(999_999, ctx.storeId, "2026-10-22")).toBe("item-not-found");
    expect(markSkipped(ctx.itemIds[0], 999_999, "2026-10-22")).toBe("store-not-found");
  });

  it("never records a purchase, so a skip does not feed the learned order", async () => {
    const { markSkipped } = await import("@/lib/shopping/skip");
    markSkipped(ctx.itemIds[0], ctx.storeId, "2026-10-22");
    expect(await purchases()).toEqual([]);
  });

  it("purges markers older than yesterday", async () => {
    const { markSkipped, purgeExpiredSkips } = await import("@/lib/shopping/skip");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    markSkipped(ctx.itemIds[0], ctx.storeId, "2026-10-20");
    markSkipped(ctx.itemIds[1], ctx.storeId, "2026-10-21");
    markSkipped(ctx.itemIds[2], ctx.storeId, "2026-10-22");
    // Noon on 2026-10-22, server-local.
    const noon = Math.floor(new Date(2026, 9, 22, 12).getTime() / 1000);
    expect(purgeExpiredSkips(noon)).toBe(1);
    const left = listShoppingItems({ skipSweep: true }).filter((i) => i.skippedAt.length > 0);
    expect(left.map((i) => i.id).sort()).toEqual([ctx.itemIds[1], ctx.itemIds[2]].sort());
  });

  it("goes away with the list entry", async () => {
    const { markSkipped } = await import("@/lib/shopping/skip");
    const { deleteItem } = await import("@/lib/shopping/items");
    const { db } = await import("@/db");
    const { shoppingItemSkip } = await import("@/db/schema");
    markSkipped(ctx.itemIds[0], ctx.storeId, "2026-10-22");
    deleteItem(ctx.itemIds[0]);
    expect(db.select().from(shoppingItemSkip).all()).toEqual([]);
  });

  it("is cleared when a checked item is re-added", async () => {
    const { markSkipped } = await import("@/lib/shopping/skip");
    const { addManualItem, patchItem } = await import("@/lib/shopping/items");
    const id = ctx.itemIds[0];
    markSkipped(id, ctx.storeId, "2026-10-22");
    patchItem(id, { checked: true }, { supermarketId: ctx.otherStoreId });
    const { item, action } = addManualItem({ ingredientId: ctx.ingredientIds[0] });
    expect(action).toBe("reactivated");
    expect(item.skippedAt).toEqual([]);
  });
});
