import { openDB, type IDBPDatabase, type DBSchema } from "idb";
import type { ShoppingItemView } from "@/lib/shopping/items";

export type OfflineShoppingItem = ShoppingItemView;

export type OfflineSupermarket = {
  id: number;
  name: string;
  categories: Array<{ categoryId: number; sortOrder: number }>;
};

export type OfflineCategory = { id: number; name: string };

export type OfflineMutation = {
  mutationId: string;
  itemId: number;
  type: "check" | "uncheck";
  queuedAt: number;
  attempts: number;
  lastError?: string;
};

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
