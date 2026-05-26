import { openOfflineDb } from "./db";
import { patchItem as apiPatchItem } from "@/components/shopping/api";
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
      const updated = await apiPatchItem(entry.itemId, {
        checked: entry.type === "check",
        mutationId: entry.mutationId,
      });
      const writeTx = db.transaction(["items", "mutationQueue"], "readwrite");
      await writeTx.objectStore("items").put(updated);
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
