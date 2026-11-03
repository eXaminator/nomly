import { openOfflineDb, type OfflineMutation } from "./db";
import type { ShoppingItemView } from "@/lib/shopping/items";

/** What a queued mutation does to one list entry (unchanged if unrelated). */
export function applyMutation(
  item: ShoppingItemView,
  m: OfflineMutation,
): ShoppingItemView {
  switch (m.type) {
    case "check":
    case "uncheck":
      if (item.id !== m.itemId) return item;
      return {
        ...item,
        checked: m.type === "check",
        checkedAt: m.type === "check" ? Math.floor(m.queuedAt / 1000) : null,
      };
    case "skip": {
      if (item.id !== m.itemId) return item;
      const others = (item.skippedAt ?? []).filter(
        (s) => s.supermarketId !== m.supermarketId,
      );
      return {
        ...item,
        skippedAt:
          m.on != null ? [...others, { supermarketId: m.supermarketId, on: m.on }] : others,
      };
    }
    case "unavailable": {
      if (item.refType !== m.refType || item.refId !== m.refId) return item;
      const ids = new Set(item.unavailableSupermarketIds);
      if (m.unavailable) ids.add(m.supermarketId);
      else ids.delete(m.supermarketId);
      return { ...item, unavailableSupermarketIds: Array.from(ids) };
    }
  }
}

/** Every pending mutation, oldest first, laid over `items`. */
export function overlayPending(
  items: ShoppingItemView[],
  queue: readonly OfflineMutation[],
): ShoppingItemView[] {
  if (queue.length === 0) return items;
  const ordered = [...queue].sort((a, b) => a.queuedAt - b.queuedAt);
  return items.map((item) => ordered.reduce(applyMutation, item));
}

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

  return overlayPending(localItems, queueEntries);
}

type Fields<T extends OfflineMutation["type"]> = Omit<
  Extract<OfflineMutation, { type: T }>,
  "mutationId" | "queuedAt" | "attempts"
>;
type NewMutation = Fields<"check" | "uncheck"> | Fields<"skip"> | Fields<"unavailable">;

/** A fresh queue entry (not stored yet) — apply it to the UI, then enqueue it. */
export function newMutation(input: NewMutation): OfflineMutation {
  return {
    ...input,
    mutationId: crypto.randomUUID(),
    queuedAt: Date.now(),
    attempts: 0,
  } as OfflineMutation;
}

/**
 * Applies a mutation to the IDB rows it touches and queues it for the sync
 * engine, in one transaction.
 */
export async function enqueueMutation(entry: OfflineMutation): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction(["items", "mutationQueue"], "readwrite");
  const items = tx.objectStore("items");
  const targets =
    entry.type === "unavailable" ? await items.getAll() : [await items.get(entry.itemId)];
  for (const current of targets) {
    if (!current) continue;
    const next = applyMutation(current, entry);
    if (next !== current) await items.put(next);
  }
  await tx.objectStore("mutationQueue").put(entry);
  await tx.done;
}

export async function toggleItemOptimistic(
  itemId: number,
  nextChecked: boolean,
  supermarketId: number | null = null,
  options: { countAsPurchase?: boolean } = {},
): Promise<void> {
  await enqueueMutation(
    newMutation({
      itemId,
      type: nextChecked ? "check" : "uncheck",
      supermarketId,
      ...(nextChecked && options.countAsPurchase === false
        ? { countAsPurchase: false }
        : {}),
    }),
  );
}

/** "Gibt's hier heute nicht" (on = device-local day) or lift it (on = null). */
export function skipMutation(
  itemId: number,
  supermarketId: number,
  on: string | null,
): OfflineMutation {
  return newMutation({ type: "skip", itemId, supermarketId, on });
}

/** "Hier (nicht) verfügbar" for the item's article at one store. */
export function unavailableMutation(
  item: Pick<ShoppingItemView, "id" | "refType" | "refId">,
  supermarketId: number,
  unavailable: boolean,
): OfflineMutation {
  return newMutation({
    type: "unavailable",
    itemId: item.id,
    refType: item.refType,
    refId: item.refId,
    supermarketId,
    unavailable,
  });
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
 * Replaces the IDB items store with `serverItems`, with every pending entry
 * in `mutationQueue` (toggle, skip, unavailable) laid on top — queued changes
 * stay applied until they're drained. Updates `meta.shoppingFetchedAt`.
 *
 * Only call this after a confirmed `offline -> online` transition or when
 * a realtime "shopping" event fires while online. Never on mount.
 */
export async function reconcileFromServer(
  serverItems: ShoppingItemView[],
): Promise<ShoppingItemView[]> {
  return (await reconcileIfCurrent(serverItems, null)) ?? serverItems;
}

/**
 * Bumped by the sync engine the moment the server confirms a queue entry —
 * before the entry leaves the queue. A server snapshot fetched before that
 * may not contain the change yet, and once the entry is gone nothing would
 * overlay it any more.
 */
let drainEpoch = 0;
export function noteDrained(): void {
  drainEpoch += 1;
}
export function currentDrainEpoch(): number {
  return drainEpoch;
}

/**
 * `reconcileFromServer` for a snapshot whose fetch started at drain epoch
 * `fetchedAtEpoch`. If an entry was confirmed since, the snapshot may predate
 * it: nothing is written and null is returned — fetch again. (Entries still
 * in the queue are fine: they're overlaid. The queue is read inside the
 * write transaction, so the drain can't delete one in between.)
 */
export async function reconcileIfCurrent(
  serverItems: ShoppingItemView[],
  fetchedAtEpoch: number | null,
): Promise<ShoppingItemView[] | null> {
  const db = await openOfflineDb();
  const tx = db.transaction(["items", "meta", "mutationQueue"], "readwrite");
  const queueEntries = await tx.objectStore("mutationQueue").getAll();
  if (fetchedAtEpoch != null && fetchedAtEpoch !== drainEpoch) {
    tx.abort();
    await tx.done.catch(() => {});
    return null;
  }
  const merged = overlayPending(serverItems, queueEntries);
  await tx.objectStore("items").clear();
  for (const item of merged) await tx.objectStore("items").put(item);
  await tx.objectStore("meta").put({
    key: "shoppingFetchedAt",
    value: Date.now(),
  });
  await tx.done;
  return merged;
}
