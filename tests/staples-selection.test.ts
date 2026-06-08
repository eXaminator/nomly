/**
 * The "add standards to the list" flow lets the user pick individual items
 * across standard lists (with optional per-item quantity overrides), mirroring
 * the add-meals dialog. Covers previewStapleGroups + addStapleSelectionToList.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-staples-sel-"));
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
  groupId: number;
  brotItemId: number;
  milchItemId: number;
  unitId: number;
};

async function seed(): Promise<Ctx> {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");
  const { createGroup, addGroupItem } = await import("@/lib/staples/groups");

  for (const t of [
    s.shoppingItemStapleSource,
    s.shoppingItemSource,
    s.shoppingItemAmount,
    s.shoppingItem,
    s.stapleGroupItem,
    s.stapleGroup,
    s.ingredient,
    s.unit,
    s.category,
  ]) {
    db.delete(t).run();
  }

  const categoryId = db
    .insert(s.category)
    .values({ name: "Backwaren" })
    .returning({ id: s.category.id })
    .all()[0].id;
  const unitId = db
    .insert(s.unit)
    .values({ name: "Stk", dimension: "count", baseUnitId: null, factor: 1 })
    .returning({ id: s.unit.id })
    .all()[0].id;
  const brot = db
    .insert(s.ingredient)
    .values({ name: "Brot", defaultCategoryId: categoryId })
    .returning({ id: s.ingredient.id })
    .all()[0].id;
  const milch = db
    .insert(s.ingredient)
    .values({ name: "Milch", defaultCategoryId: categoryId })
    .returning({ id: s.ingredient.id })
    .all()[0].id;

  const g = createGroup("Wocheneinkauf");
  const brotItemId = addGroupItem(g.id, {
    ingredientId: brot,
    quantity: 2,
    unitId,
    note: "Vollkorn",
  }).id;
  const milchItemId = addGroupItem(g.id, { ingredientId: milch }).id;

  return { groupId: g.id, brotItemId, milchItemId, unitId };
}

describe("staple selection add", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("previews every group with its items and an alreadyOnList flag", async () => {
    const { previewStapleGroups } = await import("@/lib/staples/preview");
    const groups = previewStapleGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Wocheneinkauf");
    expect(groups[0].alreadyOnList).toBe(false);
    expect(groups[0].items.map((i) => i.ingredientName).sort()).toEqual([
      "Brot",
      "Milch",
    ]);
    const brot = groups[0].items.find((i) => i.ingredientName === "Brot")!;
    expect(brot.quantity).toBe(2);
    expect(brot.note).toBe("Vollkorn");
  });

  it("adds only the selected items, not the whole group", async () => {
    const { addStapleSelectionToList } = await import("@/lib/staples/apply");
    const { listShoppingItems } = await import("@/lib/shopping/items");

    addStapleSelectionToList([
      { stapleGroupId: ctx.groupId, items: [{ stapleGroupItemId: ctx.brotItemId }] },
    ]);

    const names = listShoppingItems().map((i) => i.name);
    expect(names).toContain("Brot");
    expect(names).not.toContain("Milch");
  });

  it("honours a per-item quantity override", async () => {
    const { addStapleSelectionToList } = await import("@/lib/staples/apply");
    const { listShoppingItems } = await import("@/lib/shopping/items");

    addStapleSelectionToList([
      {
        stapleGroupId: ctx.groupId,
        items: [{ stapleGroupItemId: ctx.brotItemId, quantity: 5 }],
      },
    ]);

    const brot = listShoppingItems().find((i) => i.name === "Brot")!;
    expect(brot.stapleSources[0].contributedQuantity).toBe(5); // override, not the preset 2
  });

  it("marks a group alreadyOnList once any of its items is added", async () => {
    const { addStapleSelectionToList } = await import("@/lib/staples/apply");
    const { previewStapleGroups } = await import("@/lib/staples/preview");

    addStapleSelectionToList([
      { stapleGroupId: ctx.groupId, items: [{ stapleGroupItemId: ctx.milchItemId }] },
    ]);

    expect(previewStapleGroups()[0].alreadyOnList).toBe(true);
  });
});
