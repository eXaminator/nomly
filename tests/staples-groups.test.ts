import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-staples-groups-"));
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
  ingredientIds: { brot: number; milch: number; butter: number };
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
    stapleGroup,
    stapleGroupItem,
    unit,
  } = await import("@/db/schema");

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
  const butter = db
    .insert(ingredient)
    .values({ name: "Butter", defaultCategoryId: categoryId })
    .returning({ id: ingredient.id })
    .all()[0].id;

  return { ingredientIds: { brot, milch, butter }, unitId };
}

describe("staples groups — group CRUD", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("creates a group and returns the id and current sortOrder", async () => {
    const { createGroup } = await import("@/lib/staples/groups");
    const g = createGroup("Wocheneinkauf");
    expect(g.id).toBeGreaterThan(0);
    expect(g.name).toBe("Wocheneinkauf");
    expect(g.sortOrder).toBe(0);
  });

  it("appends sortOrder for newly-created groups", async () => {
    const { createGroup } = await import("@/lib/staples/groups");
    const a = createGroup("A");
    const b = createGroup("B");
    expect(b.sortOrder).toBe(a.sortOrder + 1);
  });

  it("rejects duplicate names with StapleGroupError code duplicate_name", async () => {
    const { createGroup, StapleGroupError } = await import(
      "@/lib/staples/groups"
    );
    createGroup("Wocheneinkauf");
    expect(() => createGroup("Wocheneinkauf")).toThrow(StapleGroupError);
    try {
      createGroup("Wocheneinkauf");
    } catch (e) {
      expect(e).toBeInstanceOf(StapleGroupError);
      expect((e as InstanceType<typeof StapleGroupError>).code).toBe(
        "duplicate_name",
      );
    }
  });

  it("lists groups with their item counts", async () => {
    const { createGroup, addGroupItem, listGroups } = await import(
      "@/lib/staples/groups"
    );
    const a = createGroup("A");
    const b = createGroup("B");
    addGroupItem(a.id, { ingredientId: ctx.ingredientIds.brot });
    addGroupItem(a.id, { ingredientId: ctx.ingredientIds.milch });
    addGroupItem(b.id, { ingredientId: ctx.ingredientIds.butter });

    const list = listGroups();
    expect(list).toHaveLength(2);
    const byId = new Map(list.map((g) => [g.id, g]));
    expect(byId.get(a.id)?.itemCount).toBe(2);
    expect(byId.get(b.id)?.itemCount).toBe(1);
  });

  it("renames a group", async () => {
    const { createGroup, renameGroup, listGroups } = await import(
      "@/lib/staples/groups"
    );
    const a = createGroup("A");
    renameGroup(a.id, "Wocheneinkauf");
    const list = listGroups();
    expect(list.find((g) => g.id === a.id)?.name).toBe("Wocheneinkauf");
  });

  it("rejects rename to a duplicate name", async () => {
    const { createGroup, renameGroup, StapleGroupError } = await import(
      "@/lib/staples/groups"
    );
    createGroup("A");
    const b = createGroup("B");
    expect(() => renameGroup(b.id, "A")).toThrow(StapleGroupError);
  });

  it("returns group detail with sorted items", async () => {
    const { createGroup, addGroupItem, getGroup } = await import(
      "@/lib/staples/groups"
    );
    const a = createGroup("A");
    addGroupItem(a.id, {
      ingredientId: ctx.ingredientIds.brot,
      quantity: 1,
      unitId: ctx.unitId,
      note: "Vollkorn",
    });
    addGroupItem(a.id, {
      ingredientId: ctx.ingredientIds.milch,
      quantity: 2,
      unitId: ctx.unitId,
    });
    const detail = getGroup(a.id);
    expect(detail).not.toBeNull();
    expect(detail!.items.map((i) => i.ingredientName)).toEqual([
      "Brot",
      "Milch",
    ]);
    expect(detail!.items[0].quantity).toBe(1);
    expect(detail!.items[0].note).toBe("Vollkorn");
    expect(detail!.items[1].quantity).toBe(2);
  });

  it("reorderGroups updates sortOrder per the passed sequence", async () => {
    const { createGroup, reorderGroups, listGroups } = await import(
      "@/lib/staples/groups"
    );
    const a = createGroup("A");
    const b = createGroup("B");
    const c = createGroup("C");
    reorderGroups([c.id, a.id, b.id]);
    const list = listGroups();
    expect(list.map((g) => g.id)).toEqual([c.id, a.id, b.id]);
  });
});

describe("staples groups — items CRUD", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("adds an item with optional quantity + unit + note", async () => {
    const { createGroup, addGroupItem, getGroup } = await import(
      "@/lib/staples/groups"
    );
    const g = createGroup("A");
    addGroupItem(g.id, {
      ingredientId: ctx.ingredientIds.brot,
      quantity: 1,
      unitId: ctx.unitId,
      note: "Vollkorn",
    });
    const detail = getGroup(g.id);
    expect(detail!.items[0].quantity).toBe(1);
    expect(detail!.items[0].unitId).toBe(ctx.unitId);
    expect(detail!.items[0].note).toBe("Vollkorn");
  });

  it("rejects adding the same ingredient twice in the same group", async () => {
    const { createGroup, addGroupItem, StapleGroupError } = await import(
      "@/lib/staples/groups"
    );
    const g = createGroup("A");
    addGroupItem(g.id, { ingredientId: ctx.ingredientIds.brot });
    expect(() =>
      addGroupItem(g.id, { ingredientId: ctx.ingredientIds.brot }),
    ).toThrow(StapleGroupError);
  });

  it("rejects quantity without unit and unit without quantity", async () => {
    const { createGroup, addGroupItem, StapleGroupError } = await import(
      "@/lib/staples/groups"
    );
    const g = createGroup("A");
    expect(() =>
      addGroupItem(g.id, {
        ingredientId: ctx.ingredientIds.brot,
        quantity: 1,
        unitId: null,
      }),
    ).toThrow(StapleGroupError);
    expect(() =>
      addGroupItem(g.id, {
        ingredientId: ctx.ingredientIds.brot,
        quantity: null,
        unitId: ctx.unitId,
      }),
    ).toThrow(StapleGroupError);
  });

  it("updates a group item's quantity / unit / note / sortOrder", async () => {
    const { createGroup, addGroupItem, updateGroupItem, getGroup } =
      await import("@/lib/staples/groups");
    const g = createGroup("A");
    const item = addGroupItem(g.id, { ingredientId: ctx.ingredientIds.brot });
    updateGroupItem(item.id, {
      quantity: 2,
      unitId: ctx.unitId,
      note: "Vollkorn",
    });
    const detail = getGroup(g.id);
    expect(detail!.items[0].quantity).toBe(2);
    expect(detail!.items[0].note).toBe("Vollkorn");
  });

  it("deletes a group item", async () => {
    const { createGroup, addGroupItem, deleteGroupItem, getGroup } =
      await import("@/lib/staples/groups");
    const g = createGroup("A");
    const item = addGroupItem(g.id, { ingredientId: ctx.ingredientIds.brot });
    addGroupItem(g.id, { ingredientId: ctx.ingredientIds.milch });
    deleteGroupItem(item.id);
    const detail = getGroup(g.id);
    expect(detail!.items.map((i) => i.ingredientName)).toEqual(["Milch"]);
  });

  it("deleting a group cascades the items", async () => {
    const { createGroup, addGroupItem, deleteGroup, getGroup } = await import(
      "@/lib/staples/groups"
    );
    const g = createGroup("A");
    addGroupItem(g.id, { ingredientId: ctx.ingredientIds.brot });
    deleteGroup(g.id);
    expect(getGroup(g.id)).toBeNull();
  });
});

describe("staples groups — delete cascade with live contributions", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("strips contributions and cleans up orphan shopping items", async () => {
    const { db } = await import("@/db");
    const { createGroup, addGroupItem, deleteGroup } = await import(
      "@/lib/staples/groups"
    );
    const { upsertShoppingItemForIngredient } = await import(
      "@/lib/shopping/itemUpsert"
    );
    const { shoppingItem, shoppingItemStapleSource } = await import(
      "@/db/schema"
    );

    const g = createGroup("A");
    addGroupItem(g.id, { ingredientId: ctx.ingredientIds.brot });

    // Simulate "group was applied to the list" — write a shopping item and
    // staple-source row.
    const { itemId } = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientIds.brot),
    );
    db.insert(shoppingItemStapleSource)
      .values({ itemId, stapleGroupId: g.id })
      .run();

    const result = deleteGroup(g.id);
    expect(result.shoppingItemsRemoved).toBe(1);
    expect(db.select().from(shoppingItem).all()).toHaveLength(0);
    expect(db.select().from(shoppingItemStapleSource).all()).toHaveLength(0);
  });

  it("preserves shopping items with other contributions", async () => {
    const { db } = await import("@/db");
    const { createGroup, addGroupItem, deleteGroup } = await import(
      "@/lib/staples/groups"
    );
    const { upsertShoppingItemForIngredient } = await import(
      "@/lib/shopping/itemUpsert"
    );
    const {
      shoppingItem,
      shoppingItemAmount,
      shoppingItemStapleSource,
    } = await import("@/db/schema");

    const g = createGroup("A");
    addGroupItem(g.id, { ingredientId: ctx.ingredientIds.brot });

    const { itemId } = db.transaction((tx) =>
      upsertShoppingItemForIngredient(tx, ctx.ingredientIds.brot),
    );
    db.insert(shoppingItemStapleSource)
      .values({ itemId, stapleGroupId: g.id })
      .run();
    // Add a manual amount so the item should NOT be deleted by the cascade.
    db.insert(shoppingItemAmount)
      .values({ itemId, quantity: 1, unitId: ctx.unitId, dimension: "count" })
      .run();

    const result = deleteGroup(g.id);
    expect(result.shoppingItemsRemoved).toBe(0);
    const items = db.select().from(shoppingItem).all();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(itemId);
  });
});
