import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-staples-apply-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  const tmpDb = drizzle(sqlite);
  migrate(tmpDb, { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

type Ctx = {
  ingredientIds: { brot: number; milch: number };
  unitId: number;
  categoryId: number;
  groupId: number;
};

async function seed(): Promise<Ctx> {
  const { db } = await import("@/db");
  const {
    category,
    ingredient,
    shoppingItem,
    shoppingItemAmount,
    shoppingItemSource,
    shoppingItemStapleSource,
    stapleGroup,
    stapleGroupItem,
    unit,
  } = await import("@/db/schema");
  const { createGroup, addGroupItem } = await import("@/lib/staples/groups");

  db.delete(shoppingItemStapleSource).run();
  db.delete(shoppingItemAmount).run();
  db.delete(shoppingItemSource).run();
  db.delete(shoppingItem).run();
  db.delete(stapleGroupItem).run();
  db.delete(stapleGroup).run();
  db.delete(ingredient).run();
  db.delete(unit).run();
  db.delete(category).run();

  const categoryId = db
    .insert(category)
    .values({ name: "Backwaren" })
    .returning({ id: category.id })
    .all()[0].id;
  const unitId = db
    .insert(unit)
    .values({ name: "Stk", dimension: "count", baseUnitId: null, factor: 1 })
    .returning({ id: unit.id })
    .all()[0].id;
  const brot = db
    .insert(ingredient)
    .values({ name: "Brot", defaultCategoryId: categoryId })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const milch = db
    .insert(ingredient)
    .values({ name: "Milch", defaultCategoryId: categoryId })
    .returning({ id: ingredient.id })
    .all()[0].id;

  const g = createGroup("Wocheneinkauf");
  addGroupItem(g.id, {
    ingredientId: brot,
    quantity: 1,
    unitId,
    note: "Vollkorn",
  });
  addGroupItem(g.id, { ingredientId: milch });

  return { ingredientIds: { brot, milch }, unitId, categoryId, groupId: g.id };
}

describe("addStapleGroupToList", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("creates shopping items and staple-source rows for each group item", async () => {
    const { db } = await import("@/db");
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { shoppingItem, shoppingItemStapleSource } = await import(
      "@/db/schema"
    );

    const result = addStapleGroupToList(ctx.groupId);
    expect(result.itemsCreated).toBe(2);
    expect(result.itemsReactivated).toBe(0);
    expect(result.affectedItemIds).toHaveLength(2);

    const items = db.select().from(shoppingItem).all();
    expect(items).toHaveLength(2);

    const sources = db
      .select()
      .from(shoppingItemStapleSource)
      .all();
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => s.stapleGroupId === ctx.groupId)).toBe(true);

    const brotSource = sources.find(
      (s) =>
        items.find((i) => i.id === s.itemId)!.ingredientId ===
        ctx.ingredientIds.brot,
    );
    expect(brotSource?.contributedQuantity).toBe(1);
    expect(brotSource?.contributedUnitId).toBe(ctx.unitId);

    const milchSource = sources.find(
      (s) =>
        items.find((i) => i.id === s.itemId)!.ingredientId ===
        ctx.ingredientIds.milch,
    );
    expect(milchSource?.contributedQuantity).toBeNull();
    expect(milchSource?.contributedUnitId).toBeNull();
  });

  it("copies the staple-item's note onto a brand-new shopping item", async () => {
    const { db } = await import("@/db");
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    addStapleGroupToList(ctx.groupId);
    const brotItem = db
      .select()
      .from(shoppingItem)
      .where(eq(shoppingItem.ingredientId, ctx.ingredientIds.brot))
      .get();
    expect(brotItem?.note).toBe("Vollkorn");
  });

  it("does not clobber an existing note on a shopping item", async () => {
    const { db } = await import("@/db");
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { upsertShoppingItemForIngredient } = await import(
      "@/lib/shopping/itemUpsert"
    );
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const { itemId } = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientIds.brot),
    );
    db.update(shoppingItem)
      .set({ note: "Glutenfrei" })
      .where(eq(shoppingItem.id, itemId))
      .run();

    addStapleGroupToList(ctx.groupId);
    const row = db
      .select()
      .from(shoppingItem)
      .where(eq(shoppingItem.id, itemId))
      .get();
    expect(row?.note).toBe("Glutenfrei");
  });

  it("merges into an existing item — does not create a second row", async () => {
    const { db } = await import("@/db");
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { upsertShoppingItemForIngredient } = await import(
      "@/lib/shopping/itemUpsert"
    );
    const { shoppingItem, shoppingItemStapleSource } = await import(
      "@/db/schema"
    );
    const { eq } = await import("drizzle-orm");

    const { itemId } = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientIds.brot),
    );

    const result = addStapleGroupToList(ctx.groupId);
    expect(result.itemsCreated).toBe(1); // only Milch was new
    expect(result.itemsIncremented).toBe(1); // Brot already existed

    const brotItems = db
      .select()
      .from(shoppingItem)
      .where(eq(shoppingItem.ingredientId, ctx.ingredientIds.brot))
      .all();
    expect(brotItems).toHaveLength(1);
    expect(brotItems[0].id).toBe(itemId);

    const brotSources = db
      .select()
      .from(shoppingItemStapleSource)
      .where(eq(shoppingItemStapleSource.itemId, itemId))
      .all();
    expect(brotSources).toHaveLength(1);
  });

  it("reactivates a checked item within the 24h grace window", async () => {
    const { db } = await import("@/db");
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { upsertShoppingItemForIngredient } = await import(
      "@/lib/shopping/itemUpsert"
    );
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const { itemId } = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientIds.brot),
    );
    const now = Math.floor(Date.now() / 1000);
    db.update(shoppingItem)
      .set({ checked: true, checkedAt: now - 3600 })
      .where(eq(shoppingItem.id, itemId))
      .run();

    const result = addStapleGroupToList(ctx.groupId);
    expect(result.itemsReactivated).toBe(1);

    const row = db
      .select()
      .from(shoppingItem)
      .where(eq(shoppingItem.id, itemId))
      .get();
    expect(row?.checked).toBe(false);
  });

  it("ignores ingredient.excludeFromShoppingList", async () => {
    const { db } = await import("@/db");
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { ingredient, shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    db.update(ingredient)
      .set({ excludeFromShoppingList: true })
      .where(eq(ingredient.id, ctx.ingredientIds.brot))
      .run();

    addStapleGroupToList(ctx.groupId);
    const brotItem = db
      .select()
      .from(shoppingItem)
      .where(eq(shoppingItem.ingredientId, ctx.ingredientIds.brot))
      .get();
    expect(brotItem).toBeDefined();
  });

  it("two consecutive adds write two source rows per item", async () => {
    const { db } = await import("@/db");
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { shoppingItemStapleSource } = await import("@/db/schema");

    addStapleGroupToList(ctx.groupId);
    addStapleGroupToList(ctx.groupId);

    const sources = db.select().from(shoppingItemStapleSource).all();
    expect(sources).toHaveLength(4);
  });

  it("applying a group with no items is a no-op", async () => {
    const { db } = await import("@/db");
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { createGroup } = await import("@/lib/staples/groups");
    const { shoppingItem, shoppingItemStapleSource } = await import(
      "@/db/schema"
    );

    const empty = createGroup("Leer");
    const result = addStapleGroupToList(empty.id);
    expect(result.affectedItemIds).toEqual([]);
    expect(db.select().from(shoppingItem).all()).toHaveLength(0);
    expect(
      db.select().from(shoppingItemStapleSource).all(),
    ).toHaveLength(0);
  });

  it("throws when the group does not exist", async () => {
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { StapleGroupError } = await import("@/lib/staples/groups");
    expect(() => addStapleGroupToList(999_999)).toThrow(StapleGroupError);
  });
});
