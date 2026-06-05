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
    amounts: [], requiredAmounts: [],
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
    stock: null,
    fullyStocked: false,
    defaultUnitId: null,
    defaultUnitName: null,
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

  it("returns IDB items unchanged when called with an empty server seed", async () => {
    // Seed IDB with two items as if from a previous online visit.
    await hydrateFromIDB([
      makeItem({ id: 1, name: "Mehl" }),
      makeItem({ id: 2, name: "Zucker" }),
    ]);

    // Now simulate a cached-shell mount: serverSeed is empty.
    const items = await hydrateFromIDB([]);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id).sort()).toEqual([1, 2]);

    // IDB still has both rows — nothing was cleared.
    const db = await openOfflineDb();
    const stored = await db.getAll("items");
    expect(stored).toHaveLength(2);
  });

  it("returns IDB items unchanged when serverSeed is null", async () => {
    await hydrateFromIDB([makeItem({ id: 1 })]);
    const items = await hydrateFromIDB(null);
    expect(items).toHaveLength(1);
  });

  it("does not clobber a locally-newer item when given a stale server seed", async () => {
    // Seed once.
    await hydrateFromIDB([makeItem({ id: 1, checked: false })]);
    // User toggles it locally (writes to IDB + queue).
    await toggleItemOptimistic(1, true);

    // Cached SSR snapshot says it's still unchecked.
    const items = await hydrateFromIDB([makeItem({ id: 1, checked: false })]);
    expect(items[0].checked).toBe(true); // IDB-authoritative; pending overlay applied
  });
});

describe("reconcileFromServer", () => {
  beforeEach(async () => {
    await resetOfflineDbForTests();
  });

  it("replaces IDB with the server snapshot when there are no pending mutations", async () => {
    const db = await openOfflineDb();
    await db.put("items", makeItem({ id: 1, name: "stale" }));

    const { reconcileFromServer } = await import("@/lib/shopping/offline/store");
    const merged = await reconcileFromServer([
      makeItem({ id: 2, name: "Salz" }),
      makeItem({ id: 3, name: "Zucker" }),
    ]);
    expect(merged.map((i) => i.id).sort()).toEqual([2, 3]);

    const stored = await db.getAll("items");
    expect(stored.map((i) => i.id).sort()).toEqual([2, 3]);
  });

  it("overlays a pending toggle on top of the server snapshot", async () => {
    const db = await openOfflineDb();
    await db.put("items", makeItem({ id: 1, checked: true }));
    await db.put("mutationQueue", {
      mutationId: "m1",
      itemId: 1,
      type: "uncheck",
      queuedAt: 7_000,
      attempts: 0,
    });

    const { reconcileFromServer } = await import("@/lib/shopping/offline/store");
    // Server insists the item is still checked.
    const merged = await reconcileFromServer([
      makeItem({ id: 1, checked: true, checkedAt: 5 }),
    ]);
    // Pending uncheck wins until drained.
    expect(merged[0].checked).toBe(false);
    expect(merged[0].checkedAt).toBeNull();
  });

  it("updates meta.shoppingFetchedAt", async () => {
    const before = Date.now();
    const { reconcileFromServer } = await import("@/lib/shopping/offline/store");
    await reconcileFromServer([makeItem({ id: 1 })]);
    const db = await openOfflineDb();
    const meta = await db.get("meta", "shoppingFetchedAt");
    expect(meta).toBeDefined();
    expect(meta!.value).toBeGreaterThanOrEqual(before);
  });
});
