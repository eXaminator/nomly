import { describe, expect, it, beforeEach } from "vitest";
import { resetOfflineDbForTests, openOfflineDb } from "@/lib/shopping/offline/db";
import { hydrateFromIDB, toggleItemOptimistic } from "@/lib/shopping/offline/store";
import type { ShoppingItemView } from "@/lib/shopping/items";

function makeItem(overrides: Partial<ShoppingItemView> = {}): ShoppingItemView {
  return {
    id: 1,
    refType: "ingredient",
    refId: 1,
    name: "Mehl",
    amounts: [],
    categoryId: null,
    categoryName: null,
    checked: false,
    checkedAt: null,
    note: null,
    sortOrder: 0,
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    unavailableSupermarketIds: [],
    sources: [],
    stapleSources: [],
    manualAmounts: [],
    ...overrides,
  };
}

describe("offline store", () => {
  beforeEach(async () => {
    await resetOfflineDbForTests();
  });

  it("hydrates from an empty IDB into the provided server snapshot", async () => {
    const server = [makeItem({ id: 1 }), makeItem({ id: 2, name: "Zucker" })];
    const items = await hydrateFromIDB(server);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id)).toEqual([1, 2]);
    // IDB now mirrors the server snapshot.
    const db = await openOfflineDb();
    const stored = await db.getAll("items");
    expect(stored).toHaveLength(2);
  });

  it("overlays a locally-pending toggle on top of the server snapshot", async () => {
    const server = [makeItem({ id: 1, checked: false, version: 1 })];
    await hydrateFromIDB(server);
    await toggleItemOptimistic(1, true);
    const items = await hydrateFromIDB([makeItem({ id: 1, checked: false, version: 1 })]);
    expect(items[0].checked).toBe(true); // local pending wins
  });

  it("writes a queue entry on optimistic toggle", async () => {
    await hydrateFromIDB([makeItem({ id: 1 })]);
    await toggleItemOptimistic(1, true);
    const db = await openOfflineDb();
    const queue = await db.getAll("mutationQueue");
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ itemId: 1, type: "check", attempts: 0 });
  });
});
