import { openOfflineDb } from "./db";
import type { ShoppingItemView } from "@/lib/shopping/items";

/**
 * Read-authoritative hydration for the /einkauf mount.
 *
 *   - If IDB has any items, return them with pending mutations overlaid.
 *     IDB is the source of truth on the client; this path covers every
 *     return visit, online or offline.
 *   - If IDB is empty AND serverSeed is non-empty, write serverSeed into
 *     IDB and return it. First-ever-visit case.
 *   - If both are empty (or serverSeed is null), return an empty list.
 *
 * Never clears IDB. Never lets serverSeed override local rows.
 */
export async function hydrateFromIDB(
  serverSeed: ShoppingItemView[] | null,
): Promise<ShoppingItemView[]> {
  const db = await openOfflineDb();
  const localItems = await db.getAll("items");

  if (localItems.length === 0) {
    if (!serverSeed || serverSeed.length === 0) return [];
    const tx = db.transaction(["items", "meta"], "readwrite");
    for (const item of serverSeed) await tx.objectStore("items").put(item);
    await tx.objectStore("meta").put({ key: "shoppingFetchedAt", value: Date.now() });
    await tx.done;
    return serverSeed;
  }

  const queueEntries = await db.getAll("mutationQueue");
  if (queueEntries.length === 0) return localItems;

  const byId = new Map(localItems.map((i) => [i.id, i] as const));
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
  supermarketId: number | null = null,
  options: { countAsPurchase?: boolean } = {},
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
    supermarketId,
    ...(nextChecked && options.countAsPurchase === false
      ? { countAsPurchase: false }
      : {}),
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

/**
 * Replaces the IDB items store with `serverItems`, preserving rows whose
 * id has a pending entry in `mutationQueue` — the queued toggle stays
 * applied until it's drained. Updates `meta.shoppingFetchedAt`.
 *
 * Only call this after a confirmed `offline -> online` transition or when
 * a realtime "shopping" event fires while online. Never on mount.
 */
export async function reconcileFromServer(
  serverItems: ShoppingItemView[],
): Promise<ShoppingItemView[]> {
  const db = await openOfflineDb();
  const queueEntries = await db.getAll("mutationQueue");
  const pendingById = new Map(queueEntries.map((e) => [e.itemId, e] as const));

  const tx = db.transaction(["items", "meta"], "readwrite");
  await tx.objectStore("items").clear();
  const merged: ShoppingItemView[] = [];
  for (const item of serverItems) {
    const pending = pendingById.get(item.id);
    if (pending) {
      const overlay: ShoppingItemView = {
        ...item,
        checked: pending.type === "check",
        checkedAt:
          pending.type === "check" ? Math.floor(pending.queuedAt / 1000) : null,
      };
      await tx.objectStore("items").put(overlay);
      merged.push(overlay);
    } else {
      await tx.objectStore("items").put(item);
      merged.push(item);
    }
  }
  await tx.objectStore("meta").put({
    key: "shoppingFetchedAt",
    value: Date.now(),
  });
  await tx.done;
  return merged;
}
