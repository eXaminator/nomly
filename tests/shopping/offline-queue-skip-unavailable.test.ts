import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { resetOfflineDbForTests, openOfflineDb } from "@/lib/shopping/offline/db";
import {
  currentDrainEpoch,
  enqueueMutation,
  hydrateFromIDB,
  reconcileFromServer,
  reconcileIfCurrent,
  skipMutation,
  toggleItemOptimistic,
  unavailableMutation,
} from "@/lib/shopping/offline/store";
import { drainQueueOnce } from "@/lib/shopping/offline/sync";
import type { ShoppingItemView } from "@/lib/shopping/items";

function makeItem(over: Partial<ShoppingItemView> = {}): ShoppingItemView {
  return {
    id: 1, refType: "ingredient", refId: 1, name: "Mehl",
    amounts: [], requiredAmounts: [], categoryId: null, categoryName: null,
    checked: false, checkedAt: null, note: null,
    sortOrder: 0, version: 1, createdAt: 0, updatedAt: 0,
    unavailableSupermarketIds: [], skippedAt: [], sources: [], stapleSources: [], manualAmounts: [],
    stock: null, fullyStocked: false, defaultUnitId: null, defaultUnitName: null,
    unspecifiedSourceCount: 0,
    ...over,
  };
}

const ok = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("queued skip / unavailable", () => {
  beforeEach(async () => {
    await resetOfflineDbForTests();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it("applies a skip to IDB and keeps it over a server snapshot until drained", async () => {
    await hydrateFromIDB([makeItem({ id: 1 }), makeItem({ id: 2, refId: 2 })]);
    await enqueueMutation(skipMutation(1, 7, "2026-11-03"));

    const db = await openOfflineDb();
    expect((await db.get("items", 1))?.skippedAt).toEqual([
      { supermarketId: 7, on: "2026-11-03" },
    ]);
    const merged = await reconcileFromServer([makeItem({ id: 1 }), makeItem({ id: 2, refId: 2 })]);
    expect(merged[0].skippedAt).toEqual([{ supermarketId: 7, on: "2026-11-03" }]);
    expect(merged[1].skippedAt).toEqual([]);
  });

  it("marks unavailable on every entry of the article", async () => {
    await hydrateFromIDB([
      makeItem({ id: 1, refId: 5 }),
      makeItem({ id: 2, refId: 5 }),
      makeItem({ id: 3, refId: 6 }),
    ]);
    await enqueueMutation(unavailableMutation({ id: 1, refType: "ingredient", refId: 5 }, 7, true));
    const items = await hydrateFromIDB(null);
    expect(items.map((i) => i.unavailableSupermarketIds)).toEqual([[7], [7], []]);
  });

  it("applies queued entries in order (skip then lift)", async () => {
    await hydrateFromIDB([makeItem({ id: 1 })]);
    const a = skipMutation(1, 7, "2026-11-03");
    const b = { ...skipMutation(1, 7, null), queuedAt: a.queuedAt + 1 };
    await enqueueMutation(a);
    await enqueueMutation(b);
    const merged = await reconcileFromServer([
      makeItem({ id: 1, skippedAt: [{ supermarketId: 7, on: "2026-11-03" }] }),
    ]);
    expect(merged[0].skippedAt).toEqual([]);
  });

  it("drains a skip as POST and a lift as DELETE", async () => {
    await hydrateFromIDB([makeItem({ id: 1 })]);
    const a = skipMutation(1, 7, "2026-11-03");
    await enqueueMutation(a);
    await enqueueMutation({ ...skipMutation(1, 7, null), queuedAt: a.queuedAt + 1 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());

    const result = await drainQueueOnce();
    expect(result).toMatchObject({ drained: 2, remaining: 0 });
    const calls = fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method]);
    expect(calls).toEqual([
      ["/api/v1/shopping/items/1/skip", "POST"],
      ["/api/v1/shopping/items/1/skip?supermarketId=7", "DELETE"],
    ]);
  });

  it("drains unavailable by article", async () => {
    await hydrateFromIDB([makeItem({ id: 1, refId: 5 })]);
    await enqueueMutation(unavailableMutation({ id: 1, refType: "ingredient", refId: 5 }, 7, true));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());
    await drainQueueOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/v1/shopping/unavailable");
    expect(JSON.parse(String(init?.body))).toEqual({ kind: "ingredient", id: 5, supermarketId: 7 });
  });

  it("drops a skip whose entry is gone on the server", async () => {
    await hydrateFromIDB([makeItem({ id: 1 })]);
    await enqueueMutation(skipMutation(1, 7, "2026-11-03"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));
    expect(await drainQueueOnce()).toMatchObject({ drained: 1, remaining: 0 });
  });

  it("keeps a skip queued while offline", async () => {
    await hydrateFromIDB([makeItem({ id: 1 })]);
    await enqueueMutation(skipMutation(1, 7, "2026-11-03"));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("net"));
    expect(await drainQueueOnce()).toMatchObject({ drained: 0, remaining: 1 });
  });

  it("keeps a queued skip on the server row a toggle drain returns", async () => {
    await hydrateFromIDB([makeItem({ id: 1, checked: true })]);
    await toggleItemOptimistic(1, false);
    const db = await openOfflineDb();
    const [toggle] = await db.getAll("mutationQueue");
    await enqueueMutation({ ...skipMutation(1, 7, "2026-11-03"), queuedAt: toggle.queuedAt + 1 });
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ item: makeItem({ id: 1, version: 2 }) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new TypeError("net");
    });
    await drainQueueOnce();
    expect((await db.get("items", 1))?.skippedAt).toEqual([
      { supermarketId: 7, on: "2026-11-03" },
    ]);
  });

  it("refuses a snapshot fetched before one of our entries was confirmed", async () => {
    await hydrateFromIDB([makeItem({ id: 1 })]);
    await enqueueMutation(skipMutation(1, 7, "2026-11-03"));
    const epoch = currentDrainEpoch();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());
    await drainQueueOnce();
    // A stale server row (no skip) must not land: the entry is no longer
    // queued to overlay it.
    expect(await reconcileIfCurrent([makeItem({ id: 1 })], epoch)).toBeNull();
    const db = await openOfflineDb();
    expect((await db.get("items", 1))?.skippedAt).toHaveLength(1);
    expect(await reconcileIfCurrent([makeItem({ id: 1 })], currentDrainEpoch())).not.toBeNull();
  });
});
