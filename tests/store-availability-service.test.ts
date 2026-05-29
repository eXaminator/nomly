import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-store-avail-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

type Ctx = { storeId: number; tomateId: number; salzId: number };

async function seed(): Promise<Ctx> {
  const { db } = await import("@/db");
  const {
    category,
    ingredient,
    shoppingItem,
    shoppingItemSource,
    supermarket,
    supermarketCategory,
  } = await import("@/db/schema");
  const { createSupermarket } = await import(
    "@/lib/stammdaten/supermarket/service"
  );
  const { addManualItem } = await import("@/lib/shopping/items");

  db.delete(shoppingItemSource).run();
  db.delete(shoppingItem).run();
  db.delete(supermarketCategory).run();
  db.delete(supermarket).run();
  db.delete(ingredient).run();
  db.delete(category).run();

  const catId = db
    .insert(category)
    .values({ name: "Gemüse" })
    .returning({ id: category.id })
    .all()[0].id;

  const tomateId = db
    .insert(ingredient)
    .values({ name: "Tomate", defaultCategoryId: catId })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const salzId = db
    .insert(ingredient)
    .values({ name: "Salz", defaultCategoryId: catId })
    .returning({ id: ingredient.id })
    .all()[0].id;

  const store = createSupermarket({ name: "Edeka", orderedCategoryIds: [catId] });

  // Both unchecked items belong to a category the store carries.
  addManualItem({ ingredientId: tomateId });
  addManualItem({ ingredientId: salzId });

  return { storeId: store.id, tomateId, salzId };
}

describe("getStoreAvailability", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("counts unchecked items the store carries", async () => {
    const { getStoreAvailability } = await import(
      "@/lib/shopping/store-availability"
    );
    const stores = getStoreAvailability();
    const edeka = stores.find((s) => s.id === ctx.storeId);
    expect(edeka).toBeDefined();
    expect(edeka!.name).toBe("Edeka");
    expect(edeka!.neededCount).toBe(2);
  });

  it("drops an item the store has been marked unable to carry", async () => {
    const { getStoreAvailability } = await import(
      "@/lib/shopping/store-availability"
    );
    const { markUnavailable } = await import("@/lib/shopping/unavailable");
    markUnavailable({ kind: "ingredient", id: ctx.tomateId }, ctx.storeId);

    const edeka = getStoreAvailability().find((s) => s.id === ctx.storeId);
    expect(edeka!.neededCount).toBe(1);
  });
});
