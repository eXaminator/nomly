import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-helpers-"));
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
  ingredientId: number;
  otherIngredientId: number;
  categoryId: number;
  unitId: number;
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
    mealPlan,
    recipe,
    recipeIngredient,
    recipeSection,
    unit,
    stapleGroup,
    stapleGroupItem,
  } = await import("@/db/schema");

  db.delete(shoppingItemStapleSource).run();
  db.delete(shoppingItemAmount).run();
  db.delete(shoppingItemSource).run();
  db.delete(shoppingItem).run();
  db.delete(stapleGroupItem).run();
  db.delete(stapleGroup).run();
  db.delete(recipeIngredient).run();
  db.delete(recipeSection).run();
  db.delete(mealPlan).run();
  db.delete(recipe).run();
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
    .values({ name: "g", dimension: "mass", baseUnitId: null, factor: 1 })
    .returning({ id: unit.id })
    .all()[0].id;

  const ingredientId = db
    .insert(ingredient)
    .values({ name: "Brot", defaultCategoryId: categoryId })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const otherIngredientId = db
    .insert(ingredient)
    .values({ name: "Milch", defaultCategoryId: categoryId })
    .returning({ id: ingredient.id })
    .all()[0].id;

  return { ingredientId, otherIngredientId, categoryId, unitId };
}

describe("upsertShoppingItemForIngredient", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("creates a new shopping item with the ingredient's default category", async () => {
    const { db } = await import("@/db");
    const { upsertShoppingItemForIngredient } = await import(
      "@/lib/shopping/itemUpsert"
    );
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const result = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientId),
    );

    expect(result.created).toBe(true);
    expect(result.reactivated).toBe(false);

    const row = db
      .select()
      .from(shoppingItem)
      .where(eq(shoppingItem.id, result.itemId))
      .get();
    expect(row?.ingredientId).toBe(ctx.ingredientId);
    expect(row?.categoryId).toBe(ctx.categoryId);
    expect(row?.checked).toBe(false);
  });

  it("returns the existing item id when the ingredient is already on the list", async () => {
    const { db } = await import("@/db");
    const { upsertShoppingItemForIngredient } = await import(
      "@/lib/shopping/itemUpsert"
    );

    const first = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientId),
    );
    const second = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientId),
    );

    expect(second.itemId).toBe(first.itemId);
    expect(second.created).toBe(false);
    expect(second.reactivated).toBe(false);
  });

  it("reactivates a checked item within the 24h grace window and clears manual quantity", async () => {
    const { db } = await import("@/db");
    const { upsertShoppingItemForIngredient } = await import(
      "@/lib/shopping/itemUpsert"
    );
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const first = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientId),
    );
    const now = Math.floor(Date.now() / 1000);
    db.update(shoppingItem)
      .set({
        checked: true,
        checkedAt: now - 3600,
        quantity: 500,
        unitId: ctx.unitId,
      })
      .where(eq(shoppingItem.id, first.itemId))
      .run();

    const second = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientId),
    );
    expect(second.itemId).toBe(first.itemId);
    expect(second.created).toBe(false);
    expect(second.reactivated).toBe(true);

    const row = db
      .select()
      .from(shoppingItem)
      .where(eq(shoppingItem.id, first.itemId))
      .get();
    expect(row?.checked).toBe(false);
    expect(row?.quantity).toBeNull();
    expect(row?.unitId).toBeNull();
  });

  it("does not reactivate a checked item outside the 24h grace window — bumps version only", async () => {
    const { db } = await import("@/db");
    const { upsertShoppingItemForIngredient } = await import(
      "@/lib/shopping/itemUpsert"
    );
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const first = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientId),
    );
    const now = Math.floor(Date.now() / 1000);
    db.update(shoppingItem)
      .set({
        checked: true,
        checkedAt: now - 25 * 3600,
        quantity: 500,
        unitId: ctx.unitId,
      })
      .where(eq(shoppingItem.id, first.itemId))
      .run();
    const beforeVersion = db
      .select({ version: shoppingItem.version })
      .from(shoppingItem)
      .where(eq(shoppingItem.id, first.itemId))
      .get()?.version;

    const second = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientId),
    );
    expect(second.itemId).toBe(first.itemId);
    expect(second.created).toBe(false);
    expect(second.reactivated).toBe(false);

    const row = db
      .select()
      .from(shoppingItem)
      .where(eq(shoppingItem.id, first.itemId))
      .get();
    expect(row?.checked).toBe(true);
    expect(row?.quantity).toBe(500);
    expect(row?.version).toBe((beforeVersion ?? 0) + 1);
  });
});

describe("cleanupOrphanShoppingItems", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("deletes items with no sources, no staple sources, no amounts, and no note", async () => {
    const { db } = await import("@/db");
    const { cleanupOrphanShoppingItems } = await import(
      "@/lib/shopping/cleanup"
    );
    const { upsertShoppingItemForIngredient } = await import(
      "@/lib/shopping/itemUpsert"
    );
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const { itemId } = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientId),
    );

    const result = db.transaction((tx) =>
      cleanupOrphanShoppingItems(tx, [itemId]),
    );
    expect(result.itemsDeleted).toBe(1);

    const row = db
      .select()
      .from(shoppingItem)
      .where(eq(shoppingItem.id, itemId))
      .get();
    expect(row).toBeUndefined();
  });

  it("preserves an item with a manual amount", async () => {
    const { db } = await import("@/db");
    const { cleanupOrphanShoppingItems } = await import(
      "@/lib/shopping/cleanup"
    );
    const { upsertShoppingItemForIngredient } = await import(
      "@/lib/shopping/itemUpsert"
    );
    const { shoppingItem, shoppingItemAmount } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const { itemId } = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientId),
    );
    db.insert(shoppingItemAmount)
      .values({ itemId, quantity: 500, unitId: ctx.unitId, dimension: "mass" })
      .run();

    const result = db.transaction((tx) =>
      cleanupOrphanShoppingItems(tx, [itemId]),
    );
    expect(result.itemsDeleted).toBe(0);

    const row = db
      .select()
      .from(shoppingItem)
      .where(eq(shoppingItem.id, itemId))
      .get();
    expect(row).toBeDefined();
  });

  it("preserves an item with a note", async () => {
    const { db } = await import("@/db");
    const { cleanupOrphanShoppingItems } = await import(
      "@/lib/shopping/cleanup"
    );
    const { upsertShoppingItemForIngredient } = await import(
      "@/lib/shopping/itemUpsert"
    );
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const { itemId } = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientId),
    );
    db.update(shoppingItem)
      .set({ note: "Vollkorn" })
      .where(eq(shoppingItem.id, itemId))
      .run();

    const result = db.transaction((tx) =>
      cleanupOrphanShoppingItems(tx, [itemId]),
    );
    expect(result.itemsDeleted).toBe(0);
  });

  it("preserves an item with a staple source", async () => {
    const { db } = await import("@/db");
    const { cleanupOrphanShoppingItems } = await import(
      "@/lib/shopping/cleanup"
    );
    const { upsertShoppingItemForIngredient } = await import(
      "@/lib/shopping/itemUpsert"
    );
    const {
      shoppingItem,
      shoppingItemStapleSource,
      stapleGroup,
    } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const { itemId } = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientId),
    );
    const groupId = db
      .insert(stapleGroup)
      .values({ name: "Wocheneinkauf" })
      .returning({ id: stapleGroup.id })
      .all()[0].id;
    db.insert(shoppingItemStapleSource)
      .values({ itemId, stapleGroupId: groupId })
      .run();

    const result = db.transaction((tx) =>
      cleanupOrphanShoppingItems(tx, [itemId]),
    );
    expect(result.itemsDeleted).toBe(0);

    const row = db
      .select()
      .from(shoppingItem)
      .where(eq(shoppingItem.id, itemId))
      .get();
    expect(row).toBeDefined();
  });

  it("touches only ids passed in (does not sweep the whole table)", async () => {
    const { db } = await import("@/db");
    const { cleanupOrphanShoppingItems } = await import(
      "@/lib/shopping/cleanup"
    );
    const { upsertShoppingItemForIngredient } = await import(
      "@/lib/shopping/itemUpsert"
    );
    const { shoppingItem } = await import("@/db/schema");

    const a = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientId),
    );
    const b = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.otherIngredientId),
    );

    const result = db.transaction((tx) =>
      cleanupOrphanShoppingItems(tx, [a.itemId]),
    );
    expect(result.itemsDeleted).toBe(1);

    const all = db.select().from(shoppingItem).all();
    expect(all.map((r) => r.id)).toEqual([b.itemId]);
  });
});
