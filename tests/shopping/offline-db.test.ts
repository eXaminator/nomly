import { describe, expect, it, beforeEach } from "vitest";
import { openOfflineDb, resetOfflineDbForTests, type OfflineShoppingItem } from "@/lib/shopping/offline/db";

describe("openOfflineDb", () => {
  beforeEach(async () => {
    await resetOfflineDbForTests();
  });

  it("creates the expected object stores", async () => {
    const db = await openOfflineDb();
    expect(Array.from(db.objectStoreNames).sort()).toEqual([
      "categories",
      "items",
      "mutationQueue",
      "meta",
      "supermarkets",
    ].sort());
  });

  it("round-trips an item through the items store", async () => {
    const db = await openOfflineDb();
    const item = { id: 7, name: "Mehl", checked: false, version: 1 } as unknown as OfflineShoppingItem;
    await db.put("items", item);
    const back = await db.get("items", 7);
    expect(back).toMatchObject(item);
  });

  it("enumerates mutationQueue entries FIFO by queuedAt", async () => {
    const db = await openOfflineDb();
    await db.put("mutationQueue", { mutationId: "b", itemId: 1, type: "check",   queuedAt: 200, attempts: 0 });
    await db.put("mutationQueue", { mutationId: "a", itemId: 1, type: "check",   queuedAt: 100, attempts: 0 });
    await db.put("mutationQueue", { mutationId: "c", itemId: 2, type: "uncheck", queuedAt: 300, attempts: 0 });
    const tx = db.transaction("mutationQueue", "readonly");
    const ordered = await tx.store.index("byQueuedAt").getAll();
    expect(ordered.map((e) => e.mutationId)).toEqual(["a", "b", "c"]);
  });
});
