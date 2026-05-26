import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { resetOfflineDbForTests, openOfflineDb } from "@/lib/shopping/offline/db";
import { drainQueueOnce } from "@/lib/shopping/offline/sync";
import type { ShoppingItemView } from "@/lib/shopping/items";

function makeItem(over: Partial<ShoppingItemView> = {}): ShoppingItemView {
  return {
    id: 1, refType: "ingredient", refId: 1, name: "Mehl",
    amounts: [], categoryId: null, categoryName: null,
    checked: false, checkedAt: null, note: null,
    sortOrder: 0, version: 1, createdAt: 0, updatedAt: 0,
    unavailableSupermarketIds: [], sources: [], stapleSources: [], manualAmounts: [],
    ...over,
  };
}

describe("drainQueueOnce", () => {
  beforeEach(async () => {
    await resetOfflineDbForTests();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears queued entries on a successful PATCH and updates the item row", async () => {
    const db = await openOfflineDb();
    await db.put("items", makeItem({ id: 1, version: 1 }));
    await db.put("mutationQueue", {
      mutationId: "m1", itemId: 1, type: "check", queuedAt: 100, attempts: 0,
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ item: makeItem({ id: 1, checked: true, version: 2 }) }),
        { status: 200, headers: { "content-type": "application/json" } }),
    );

    const result = await drainQueueOnce();
    expect(result.drained).toBe(1);
    expect(result.remaining).toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();

    const queue = await db.getAll("mutationQueue");
    expect(queue).toEqual([]);
    const row = await db.get("items", 1);
    expect(row).toMatchObject({ checked: true, version: 2 });
  });

  it("keeps the entry and bumps attempts on a network failure", async () => {
    const db = await openOfflineDb();
    await db.put("items", makeItem({ id: 1 }));
    await db.put("mutationQueue", {
      mutationId: "m1", itemId: 1, type: "check", queuedAt: 100, attempts: 0,
    });

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("net"));

    const result = await drainQueueOnce();
    expect(result.drained).toBe(0);
    expect(result.remaining).toBe(1);
    expect(result.lastErrorKind).toBe("network");

    const queue = await db.getAll("mutationQueue");
    expect(queue[0].attempts).toBe(1);
  });

  it("flags sessionExpired on a 401 response", async () => {
    const db = await openOfflineDb();
    await db.put("items", makeItem({ id: 1 }));
    await db.put("mutationQueue", {
      mutationId: "m1", itemId: 1, type: "check", queuedAt: 100, attempts: 0,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );

    const result = await drainQueueOnce();
    expect(result.drained).toBe(0);
    expect(result.lastErrorKind).toBe("auth");

    const queue = await db.getAll("mutationQueue");
    expect(queue).toHaveLength(1); // not removed
  });
});
