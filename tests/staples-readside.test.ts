import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-staples-readside-"));
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
  addGroupItem(g.id, { ingredientId: brot, quantity: 2, unitId });
  addGroupItem(g.id, { ingredientId: milch });

  return {
    ingredientIds: { brot, milch },
    unitId,
    groupId: g.id,
  };
}

describe("listShoppingItems — staple sources", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("exposes stapleSources on the view with the group name", async () => {
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { listShoppingItems } = await import("@/lib/shopping/items");

    addStapleGroupToList(ctx.groupId);
    const items = listShoppingItems();
    const brotItem = items.find((i) => i.refId === ctx.ingredientIds.brot);
    expect(brotItem).toBeDefined();
    expect(brotItem!.stapleSources).toHaveLength(1);
    expect(brotItem!.stapleSources[0].stapleGroupId).toBe(ctx.groupId);
    expect(brotItem!.stapleSources[0].stapleGroupName).toBe("Wocheneinkauf");
    expect(brotItem!.stapleSources[0].contributedQuantity).toBe(2);
    expect(brotItem!.stapleSources[0].contributedUnit).toBe("Stk");
  });

  it("aggregates staple contributions into amounts (count dimension)", async () => {
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { listShoppingItems } = await import("@/lib/shopping/items");

    // Two adds → expected 4 Stk total (2 + 2).
    addStapleGroupToList(ctx.groupId);
    addStapleGroupToList(ctx.groupId);

    const items = listShoppingItems();
    const brotItem = items.find((i) => i.refId === ctx.ingredientIds.brot)!;
    const countAmount = brotItem.amounts.find((a) => a.dimension === "count");
    expect(countAmount).toBeDefined();
    expect(countAmount!.quantity).toBe(4);
  });

  it("items without a default quantity have a staple source and a null-quantity none-dimension amount", async () => {
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { listShoppingItems } = await import("@/lib/shopping/items");

    addStapleGroupToList(ctx.groupId);
    const items = listShoppingItems();
    const milchItem = items.find((i) => i.refId === ctx.ingredientIds.milch)!;
    expect(milchItem.stapleSources).toHaveLength(1);
    expect(milchItem.stapleSources[0].contributedQuantity).toBeNull();
    // A null-quantity contribution lands in the "none" dimension bucket with
    // quantity=null — same as a meal source for an ingredient without a
    // recipe quantity (e.g. Salz). Display layer renders it as an open-ended
    // entry without a number.
    expect(milchItem.amounts).toHaveLength(1);
    expect(milchItem.amounts[0].dimension).toBe("none");
    expect(milchItem.amounts[0].quantity).toBeNull();
  });
});
