import { openOfflineDb, type OfflineMutation } from "./db";
import {
  patchItem as apiPatchItem,
  setSkipped as apiSetSkipped,
  setUnavailable as apiSetUnavailable,
} from "@/components/shopping/api";
import type { ShoppingItemView } from "@/lib/shopping/items";
import { noteDrained, overlayPending } from "./store";
import { setConnectivity } from "./connectivity";

export type DrainResult = {
  drained: number;
  remaining: number;
  lastErrorKind?: "network" | "auth" | "server";
};

function isAuthErrorMessage(message: string): boolean {
  // Matches the shape produced by `jsonOrThrow` in components/shopping/api.ts.
  return /\(401\)/.test(message);
}

/**
 * Sends one queue entry. Returns the updated row for toggles (the PATCH
 * answers with it); skip/unavailable answer "ok" and the optimistic IDB row
 * already shows their effect.
 */
async function send(entry: OfflineMutation): Promise<ShoppingItemView | null> {
  switch (entry.type) {
    case "check":
    case "uncheck":
      return apiPatchItem(entry.itemId, {
        checked: entry.type === "check",
        mutationId: entry.mutationId,
        clientStampedAt: entry.queuedAt,
        supermarketId: entry.supermarketId ?? null,
        ...(entry.countAsPurchase === false ? { countAsPurchase: false } : {}),
      });
    case "skip":
      // Idempotent on the server (upsert / delete), so a retry after a lost
      // response is harmless.
      try {
        await apiSetSkipped(entry.itemId, entry.supermarketId, entry.on);
      } catch (err) {
        // The entry (or store) is gone meanwhile — nothing left to mark.
        if (isNotFoundMessage(err)) return null;
        throw err;
      }
      return null;
    case "unavailable":
      await apiSetUnavailable(
        entry.refType,
        entry.refId,
        entry.supermarketId,
        entry.unavailable,
      );
      return null;
  }
}

function isNotFoundMessage(err: unknown): boolean {
  return err instanceof Error && /\(404\)/.test(err.message);
}

export async function drainQueueOnce(): Promise<DrainResult> {
  const db = await openOfflineDb();
  let drained = 0;
  let lastErrorKind: DrainResult["lastErrorKind"] | undefined;

  while (true) {
    const tx = db.transaction("mutationQueue", "readonly");
    const ordered = await tx.store.index("byQueuedAt").getAll();
    if (ordered.length === 0) break;
    const entry = ordered[0];

    try {
      const updated = await send(entry);
      noteDrained();
      const writeTx = db.transaction(["items", "mutationQueue"], "readwrite");
      if (updated) {
        // Entries still queued behind this one (e.g. a skip right after an
        // uncheck) must stay visible on the server's fresh row.
        const rest = ordered.slice(1);
        await writeTx.objectStore("items").put(overlayPending([updated], rest)[0]);
      }
      await writeTx.objectStore("mutationQueue").delete(entry.mutationId);
      await writeTx.done;
      drained++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const kind: DrainResult["lastErrorKind"] = isAuthErrorMessage(message)
        ? "auth"
        : err instanceof TypeError
          ? "network"
          : "server";
      await db.put("mutationQueue", {
        ...entry,
        attempts: entry.attempts + 1,
        lastError: message,
      });
      lastErrorKind = kind;
      if (kind === "auth") setConnectivity("sessionExpired");
      else if (kind === "network") setConnectivity("offline");
      break;
    }
  }

  const tx = db.transaction("mutationQueue", "readonly");
  const remaining = (await tx.store.getAll()).length;
  return { drained, remaining, lastErrorKind };
}

let draining = false;
let again = false;

export async function kickSync(): Promise<void> {
  if (draining) {
    again = true;
    return;
  }
  draining = true;
  try {
    do {
      again = false;
      await drainQueueOnce();
    } while (again);
  } finally {
    draining = false;
  }
}
