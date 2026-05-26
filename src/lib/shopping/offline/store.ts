import { openOfflineDb } from "./db";
import type { ShoppingItemView } from "@/lib/shopping/items";

// Replace the IDB items store with the server snapshot, then overlay any
// locally-pending toggles so the user's optimistic state survives a
// re-fetch. Returns the merged list.
export async function hydrateFromIDB(
  serverItems: ShoppingItemView[],
): Promise<ShoppingItemView[]> {
  const db = await openOfflineDb();

  // Stage 1: snapshot replace.
  const tx = db.transaction(["items", "meta"], "readwrite");
  await tx.objectStore("items").clear();
  for (const item of serverItems) {
    await tx.objectStore("items").put(item);
  }
  await tx.objectStore("meta").put({ key: "shoppingFetchedAt", value: Date.now() });
  await tx.done;

  // Stage 2: overlay pending toggles.
  const queueEntries = await db.getAll("mutationQueue");
  if (queueEntries.length === 0) return serverItems;

  const byId = new Map(serverItems.map((i) => [i.id, i] as const));
  for (const entry of queueEntries) {
    const base = byId.get(entry.itemId);
    if (!base) continue;
    byId.set(entry.itemId, {
      ...base,
      checked: entry.type === "check",
      checkedAt: entry.type === "check" ? Math.floor(entry.queuedAt / 1000) : null,
    });
  }
  return Array.from(byId.values());
}

export async function toggleItemOptimistic(
  itemId: number,
  nextChecked: boolean,
): Promise<void> {
  const db = await openOfflineDb();
  const mutationId = crypto.randomUUID();
  const now = Date.now();

  const tx = db.transaction(["items", "mutationQueue"], "readwrite");
  const current = await tx.objectStore("items").get(itemId);
  if (current) {
    await tx.objectStore("items").put({
      ...current,
      checked: nextChecked,
      checkedAt: nextChecked ? Math.floor(now / 1000) : null,
    });
  }
  await tx.objectStore("mutationQueue").put({
    mutationId,
    itemId,
    type: nextChecked ? "check" : "uncheck",
    queuedAt: now,
    attempts: 0,
  });
  await tx.done;
}

export async function readItemsFromIDB(): Promise<ShoppingItemView[]> {
  const db = await openOfflineDb();
  return db.getAll("items");
}

export async function readPendingQueue() {
  const db = await openOfflineDb();
  const tx = db.transaction("mutationQueue", "readonly");
  return tx.store.index("byQueuedAt").getAll();
}
