import { openDB, type IDBPDatabase, type DBSchema } from "idb";
import type { ShoppingItemView } from "@/lib/shopping/items";
import type { LearnedOrder } from "@/lib/shopping/learned-order";

export type OfflineShoppingItem = ShoppingItemView;

export type OfflineSupermarket = {
  id: number;
  name: string;
  categories: Array<{ categoryId: number; sortOrder: number }>;
  learnedOrder?: LearnedOrder;
};

export type OfflineCategory = { id: number; name: string };

type MutationBase = {
  mutationId: string;
  /** The list entry acted on (for "unavailable" the one the user tapped). */
  itemId: number;
  queuedAt: number;
  attempts: number;
  lastError?: string;
};

/** Check / uncheck — the original (and only pre-union) entry shape. */
export type ToggleMutation = MutationBase & {
  type: "check" | "uncheck";
  /** Store filter active at toggle time (frozen then, not read at drain
   *  time — the user may have switched stores meanwhile). Absent on entries
   *  queued before the field existed. */
  supermarketId?: number | null;
  /** false: a check that must not record a purchase. Absent = a purchase. */
  countAsPurchase?: boolean;
};

/** "Gibt's hier heute nicht": mark (`on` = device-local day) or lift (null). */
export type SkipMutation = MutationBase & {
  type: "skip";
  supermarketId: number;
  on: string | null;
};

/** "Hier nicht verfügbar" — per article, so every entry of it is affected. */
export type UnavailableMutation = MutationBase & {
  type: "unavailable";
  refType: "ingredient";
  refId: number;
  supermarketId: number;
  unavailable: boolean;
};

export type OfflineMutation = ToggleMutation | SkipMutation | UnavailableMutation;

export type OfflineMeta =
  | { key: "shoppingFetchedAt"; value: number }
  | { key: "supermarketsFetchedAt"; value: number }
  | { key: "schemaVersion"; value: number };

export interface NomlyDB extends DBSchema {
  items:         { key: number; value: OfflineShoppingItem; indexes: { byChecked: number } };
  supermarkets:  { key: number; value: OfflineSupermarket };
  categories:    { key: number; value: OfflineCategory };
  mutationQueue: { key: string; value: OfflineMutation; indexes: { byQueuedAt: number } };
  meta:          { key: string; value: OfflineMeta };
}

const DB_NAME = "nomly";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<NomlyDB>> | null = null;

export function openOfflineDb(): Promise<IDBPDatabase<NomlyDB>> {
  if (!dbPromise) {
    dbPromise = openDB<NomlyDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const items = db.createObjectStore("items", { keyPath: "id" });
        items.createIndex("byChecked", "checked");

        db.createObjectStore("supermarkets", { keyPath: "id" });
        db.createObjectStore("categories", { keyPath: "id" });

        const queue = db.createObjectStore("mutationQueue", { keyPath: "mutationId" });
        queue.createIndex("byQueuedAt", "queuedAt");

        db.createObjectStore("meta", { keyPath: "key" });
      },
    });
  }
  return dbPromise;
}

export async function resetOfflineDbForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
