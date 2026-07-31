import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-purchase-"));
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

const DAY = 24 * 60 * 60;

async function reset() {
  const { db } = await import("@/db");
  const {
    category,
    ingredient,
    ingredientPurchase,
    shoppingItem,
    shoppingItemAmount,
    unit,
  } = await import("@/db/schema");
  db.delete(ingredientPurchase).run();
  db.delete(shoppingItemAmount).run();
  db.delete(shoppingItem).run();
  db.delete(ingredient).run();
  db.delete(unit).run();
  db.delete(category).run();
}

async function makeIngredient(name: string): Promise<number> {
  const { db } = await import("@/db");
  const { ingredient } = await import("@/db/schema");
  return db
    .insert(ingredient)
    .values({ name })
    .returning({ id: ingredient.id })
    .all()[0].id;
}

/** Insert a purchase row directly at a given day-offset from `base`. */
async function seedPurchase(
  ingredientId: number,
  purchasedAt: number,
): Promise<void> {
  const { db } = await import("@/db");
  const { ingredientPurchase } = await import("@/db/schema");
  db.insert(ingredientPurchase)
    .values({ ingredientId, shoppingItemId: null, purchasedAt })
    .run();
}

beforeEach(async () => {
  await reset();
});

describe("loadPurchaseStats", () => {
  it("returns nothing for an ingredient never bought", async () => {
    const { loadPurchaseStats, getPurchaseStats } = await import(
      "@/lib/ingredients/purchase-stats"
    );
    const id = await makeIngredient("Nie gekauft");
    expect(loadPurchaseStats([id]).has(id)).toBe(false);
    const stats = getPurchaseStats(id);
    expect(stats).toEqual({
      lastPurchasedAt: null,
      purchaseCount: 0,
      averageIntervalDays: null,
    });
  });

  it("records last purchase + count but no average below 3 purchases", async () => {
    const { getPurchaseStats } = await import("@/lib/ingredients/purchase-stats");
    const id = await makeIngredient("Zweimal");
    const now = 1_800_000_000;
    await seedPurchase(id, now - 10 * DAY);
    await seedPurchase(id, now);
    const stats = getPurchaseStats(id);
    expect(stats.purchaseCount).toBe(2);
    expect(stats.lastPurchasedAt).toBe(now);
    expect(stats.averageIntervalDays).toBeNull();
  });

  it("computes the mean interval once 3+ purchases exist", async () => {
    const { getPurchaseStats } = await import("@/lib/ingredients/purchase-stats");
    const id = await makeIngredient("Regelmäßig");
    const now = 1_800_000_000;
    // Purchases at day 0, 7, 21 → span 21 days over 2 intervals → mean 10.5.
    await seedPurchase(id, now - 21 * DAY);
    await seedPurchase(id, now - 14 * DAY);
    await seedPurchase(id, now);
    const stats = getPurchaseStats(id);
    expect(stats.purchaseCount).toBe(3);
    expect(stats.lastPurchasedAt).toBe(now);
    expect(stats.averageIntervalDays).toBeCloseTo(10.5, 5);
  });

  it("collapses multiple same-day purchases into one", async () => {
    const { getPurchaseStats } = await import("@/lib/ingredients/purchase-stats");
    const id = await makeIngredient("Doppelt am Tag");
    const now = 1_800_000_000;
    await seedPurchase(id, now - 20 * DAY);
    await seedPurchase(id, now - 10 * DAY);
    await seedPurchase(id, now); // same day...
    await seedPurchase(id, now + 3600); // ...as this one (1h later)
    const stats = getPurchaseStats(id);
    // The two same-day check-offs collapse to a single purchase day (kept at
    // the later timestamp), so the mean interval is ~10 days over 2 intervals.
    expect(stats.purchaseCount).toBe(3);
    expect(stats.averageIntervalDays).toBeCloseTo(10, 1);
  });
});

describe("purchase recording via patchItem", () => {
  async function addAndGetItem(ingredientId: number): Promise<number> {
    const { addManualItem } = await import("@/lib/shopping/items");
    return addManualItem({ ingredientId }).item.id;
  }

  it("records a purchase when an item is checked off, retracts on uncheck", async () => {
    const { patchItem } = await import("@/lib/shopping/items");
    const { getPurchaseStats } = await import("@/lib/ingredients/purchase-stats");
    const id = await makeIngredient("Milch");
    const itemId = await addAndGetItem(id);

    patchItem(itemId, { checked: true });
    expect(getPurchaseStats(id).purchaseCount).toBe(1);

    patchItem(itemId, { checked: false });
    expect(getPurchaseStats(id).purchaseCount).toBe(0);
  });

  it("does not double-count a repeated check on the same item", async () => {
    const { patchItem } = await import("@/lib/shopping/items");
    const { getPurchaseStats } = await import("@/lib/ingredients/purchase-stats");
    const id = await makeIngredient("Butter");
    const itemId = await addAndGetItem(id);

    patchItem(itemId, { checked: true });
    patchItem(itemId, { checked: true });
    expect(getPurchaseStats(id).purchaseCount).toBe(1);
  });

  it("uncheck removes the buy log, so re-checking leaves exactly one purchase", async () => {
    const { patchItem } = await import("@/lib/shopping/items");
    const { getPurchaseStats } = await import("@/lib/ingredients/purchase-stats");
    const { db } = await import("@/db");
    const { ingredientPurchase } = await import("@/db/schema");
    const id = await makeIngredient("Joghurt");
    const itemId = await addAndGetItem(id);

    // Check → uncheck (undo) → re-check: the undo must delete the log entry so
    // the re-check does not add a second one.
    patchItem(itemId, { checked: true });
    patchItem(itemId, { checked: false });
    expect(getPurchaseStats(id).purchaseCount).toBe(0);

    patchItem(itemId, { checked: true });
    expect(getPurchaseStats(id).purchaseCount).toBe(1);

    // And there is a single physical row, not two.
    const rows = db
      .select()
      .from(ingredientPurchase)
      .all()
      .filter((r) => r.ingredientId === id);
    expect(rows.length).toBe(1);
  });

  it("keeps the purchase after the checked item is swept", async () => {
    const { patchItem } = await import("@/lib/shopping/items");
    const { sweepCheckedItems } = await import("@/lib/shopping/sweeper");
    const { getPurchaseStats } = await import("@/lib/ingredients/purchase-stats");
    const { db } = await import("@/db");
    const { shoppingItem } = await import("@/db/schema");
    const id = await makeIngredient("Käse");
    const itemId = await addAndGetItem(id);

    patchItem(itemId, { checked: true });
    // Force the checkedAt well into the past so the sweep removes it.
    const { eq } = await import("drizzle-orm");
    db.update(shoppingItem)
      .set({ checkedAt: Math.floor(Date.now() / 1000) - 3 * DAY })
      .where(eq(shoppingItem.id, itemId))
      .run();
    const { deletedIds } = sweepCheckedItems();
    expect(deletedIds).toContain(itemId);
    // History survives the item deletion.
    expect(getPurchaseStats(id).purchaseCount).toBe(1);
  });
});

describe("previewDueSoonIngredients", () => {
  it("suggests ingredients due within the window and marks overdue", async () => {
    const { previewDueSoonIngredients } = await import("@/lib/shopping/due-soon");
    const now = 1_800_000_000;
    // "Kaffee": bought every 7 days, last 6 days ago → next due in ~1 day.
    const kaffee = await makeIngredient("Kaffee");
    await seedPurchase(kaffee, now - 20 * DAY);
    await seedPurchase(kaffee, now - 13 * DAY);
    await seedPurchase(kaffee, now - 6 * DAY);
    // "Reis": every 30 days, last 2 days ago → next due in ~28 days (outside a
    // 7-day window).
    const reis = await makeIngredient("Reis");
    await seedPurchase(reis, now - 62 * DAY);
    await seedPurchase(reis, now - 32 * DAY);
    await seedPurchase(reis, now - 2 * DAY);
    // "Tee": only 2 purchases → no average → never suggested.
    const tee = await makeIngredient("Tee");
    await seedPurchase(tee, now - 10 * DAY);
    await seedPurchase(tee, now - 5 * DAY);

    const within7 = previewDueSoonIngredients(7, now);
    const names = within7.map((i) => i.ingredientName);
    expect(names).toContain("Kaffee");
    expect(names).not.toContain("Reis");
    expect(names).not.toContain("Tee");

    const kaffeeItem = within7.find((i) => i.ingredientName === "Kaffee")!;
    expect(kaffeeItem.averageIntervalDays).toBeCloseTo(7, 5);
    expect(kaffeeItem.dueInDays).toBe(1);

    // A wider window pulls in Reis too.
    const within30 = previewDueSoonIngredients(30, now);
    expect(within30.map((i) => i.ingredientName)).toContain("Reis");
  });

  it("never proposes an ingredient already on the list", async () => {
    const { previewDueSoonIngredients, addDueSoonToList } = await import(
      "@/lib/shopping/due-soon"
    );
    const now = 1_800_000_000;
    const salz = await makeIngredient("Salz");
    await seedPurchase(salz, now - 21 * DAY);
    await seedPurchase(salz, now - 14 * DAY);
    await seedPurchase(salz, now - 7 * DAY);

    // Due, and not on the list yet → suggested.
    expect(previewDueSoonIngredients(14, now).map((i) => i.ingredientName)).toContain(
      "Salz",
    );

    // Once it's on the list, it drops out of the suggestions entirely.
    const res = addDueSoonToList([salz]);
    expect(res.itemsCreated).toBe(1);
    expect(previewDueSoonIngredients(14, now).map((i) => i.ingredientName)).not.toContain(
      "Salz",
    );
  });
});
