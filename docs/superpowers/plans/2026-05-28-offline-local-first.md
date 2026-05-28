# Offline local-first redesign — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the offline-mode bug class on `/einkauf` by inverting the data flow so IndexedDB is the source of truth on the client, making connectivity pessimistic-by-default, and adding client-timestamp newest-wins on the server.

**Architecture:** Server adds an LWW gate to `patchItem` keyed on `clientStampedAt` (ms epoch) vs `shopping_item.updatedAt`. Client mutation queue propagates the queued-at timestamp on every toggle replay. The IDB store stops clearing on mount and exposes a separate `reconcileFromServer` for the post-online-transition path. The connectivity module starts in a new `"checking"` state with an immediate probe. The `/einkauf` page reads an `X-Nomly-Shell` header set by the SW pre-cache so the offline shell carries no items.

**Tech Stack:** Next.js 16, TypeScript, Drizzle ORM + better-sqlite3 (server), `idb` micro-lib for IndexedDB (client), Vitest with `fake-indexeddb`, hand-rolled service worker.

**Spec:** `docs/superpowers/specs/2026-05-28-offline-local-first-design.md`

**Verification cadence:** every task ends with `npm run test -- <changed file>` and a commit. The final task adds `npm run typecheck && npm run lint && npm run test`.

---

## Task 1: Server LWW gate on `patchItem`

**Files:**
- Modify: `src/lib/shopping/items.ts:892-934`
- Test: `tests/shopping.test.ts` (new `describe` block appended)

- [ ] **Step 1: Write the failing test**

Append to `tests/shopping.test.ts` after the last existing `describe` block:

```ts
describe("patchItem LWW (client-stamped newest-wins)", () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await seed(); });

  it("applies a toggle when no clientStampedAt is provided (legacy path)", async () => {
    const { db } = await import("@/db");
    const { shoppingItem } = await import("@/db/schema");
    const inserted = db
      .insert(shoppingItem)
      .values({ ingredientId: ctx.ingredientIds.salz, checked: false })
      .returning({ id: shoppingItem.id })
      .all();
    const id = inserted[0].id;

    const { patchItem } = await import("@/lib/shopping/items");
    const v = patchItem(id, { checked: true });
    expect(v.checked).toBe(true);
    expect(v.checkedAt).not.toBeNull();
  });

  it("applies when clientStampedAt is newer than updatedAt", async () => {
    const { db } = await import("@/db");
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const inserted = db
      .insert(shoppingItem)
      .values({ ingredientId: ctx.ingredientIds.salz, checked: false, updatedAt: 1000 })
      .returning({ id: shoppingItem.id })
      .all();
    const id = inserted[0].id;

    const { patchItem } = await import("@/lib/shopping/items");
    // 2000 seconds later in ms.
    const v = patchItem(id, { checked: true }, { clientStampedAt: 2000 * 1000 });
    expect(v.checked).toBe(true);

    const row = db
      .select({ updatedAt: shoppingItem.updatedAt, checkedAt: shoppingItem.checkedAt })
      .from(shoppingItem)
      .where(eq(shoppingItem.id, id))
      .get();
    // updatedAt was at least 2000 (capped at now in real time, but >= 2000).
    expect(row!.updatedAt).toBeGreaterThanOrEqual(2000);
  });

  it("skips the write when clientStampedAt is older than updatedAt", async () => {
    const { db } = await import("@/db");
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const inserted = db
      .insert(shoppingItem)
      .values({
        ingredientId: ctx.ingredientIds.salz,
        checked: true,
        checkedAt: 5000,
        updatedAt: 5000,
      })
      .returning({ id: shoppingItem.id })
      .all();
    const id = inserted[0].id;

    const { patchItem } = await import("@/lib/shopping/items");
    // Stale offline replay: client thinks they unchecked at second 3000.
    const v = patchItem(id, { checked: false }, { clientStampedAt: 3000 * 1000 });
    // Returns the current (untouched) row.
    expect(v.checked).toBe(true);
    expect(v.checkedAt).toBe(5000);

    const row = db
      .select({ updatedAt: shoppingItem.updatedAt })
      .from(shoppingItem)
      .where(eq(shoppingItem.id, id))
      .get();
    expect(row!.updatedAt).toBe(5000); // untouched
  });

  it("caps clientStampedAt at unixepoch() to defeat future-dated clocks", async () => {
    const { db } = await import("@/db");
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const inserted = db
      .insert(shoppingItem)
      .values({ ingredientId: ctx.ingredientIds.salz, checked: false, updatedAt: 1000 })
      .returning({ id: shoppingItem.id })
      .all();
    const id = inserted[0].id;

    const { patchItem } = await import("@/lib/shopping/items");
    const farFuture = (Math.floor(Date.now() / 1000) + 10_000) * 1000;
    patchItem(id, { checked: true }, { clientStampedAt: farFuture });

    const row = db
      .select({ updatedAt: shoppingItem.updatedAt })
      .from(shoppingItem)
      .where(eq(shoppingItem.id, id))
      .get();
    const now = Math.floor(Date.now() / 1000);
    // updatedAt clamped to "now", not the far-future client timestamp.
    expect(row!.updatedAt).toBeLessThanOrEqual(now + 2);
    expect(row!.updatedAt).toBeGreaterThanOrEqual(now - 2);
  });

  it("does not gate non-checked patches (note edits apply unconditionally)", async () => {
    const { db } = await import("@/db");
    const { shoppingItem } = await import("@/db/schema");
    const inserted = db
      .insert(shoppingItem)
      .values({
        ingredientId: ctx.ingredientIds.salz,
        checked: true,
        checkedAt: 5000,
        updatedAt: 5000,
        note: "old",
      })
      .returning({ id: shoppingItem.id })
      .all();
    const id = inserted[0].id;

    const { patchItem } = await import("@/lib/shopping/items");
    // Stale clientStampedAt; note patch should still apply since it's not a check.
    const v = patchItem(id, { note: "new" }, { clientStampedAt: 3000 * 1000 });
    expect(v.note).toBe("new");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/shopping.test.ts -t "patchItem LWW"`
Expected: FAIL — `patchItem` signature does not accept a third argument; the TS type-check inside vitest will refuse to call it that way, or the runtime will silently ignore the third arg and tests `skips the write when…` and `caps clientStampedAt…` will fail.

- [ ] **Step 3: Implement the LWW gate**

Edit `src/lib/shopping/items.ts`. Replace the `PatchInput` type and `patchItem` function (currently lines 892–934) with:

```ts
export type PatchInput = {
  checked?: boolean;
  note?: string | null;
};

export type PatchOptions = {
  /**
   * Client-side wall-clock at the moment the user toggled the item (ms epoch).
   * When provided, gates the write: if the row's `updatedAt` is newer than
   * this timestamp, the patch is a no-op and the current row is returned.
   * Only the `checked` field is gated — non-checked patches apply
   * unconditionally even when `clientStampedAt` is present.
   */
  clientStampedAt?: number;
};

export function patchItem(
  id: number,
  patch: PatchInput,
  options: PatchOptions = {},
): ShoppingItemView {
  const existing = db
    .select({
      id: shoppingItem.id,
      checked: shoppingItem.checked,
      updatedAt: shoppingItem.updatedAt,
    })
    .from(shoppingItem)
    .where(eq(shoppingItem.id, id))
    .get();
  if (!existing) throw new ShoppingApiError("item not found", 404);

  const wantsCheckedChange = Object.prototype.hasOwnProperty.call(patch, "checked");
  const clientTs = options.clientStampedAt;

  // LWW gate: only for toggles, only when a client timestamp is supplied.
  if (wantsCheckedChange && clientTs != null) {
    const clientSeconds = Math.floor(clientTs / 1000);
    if (clientSeconds < existing.updatedAt) {
      const v = getItemView(id);
      if (!v) throw new ShoppingApiError("item not found", 404);
      return v;
    }
  }

  const set: Partial<typeof shoppingItem.$inferInsert> = {};
  const nowSeconds = Math.floor(Date.now() / 1000);
  // Cap the client timestamp at "now" so a clock-skewed device cannot
  // lock the row against legitimate future writes.
  const cappedClientSeconds =
    clientTs != null ? Math.min(Math.floor(clientTs / 1000), nowSeconds) : null;

  if (wantsCheckedChange) {
    set.checked = patch.checked;
    set.checkedAt = patch.checked
      ? (cappedClientSeconds ?? nowSeconds)
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "note")) {
    set.note = patch.note ?? null;
  }
  if (Object.keys(set).length === 0) {
    const v = getItemView(id);
    if (!v) throw new ShoppingApiError("item not found", 404);
    return v;
  }

  // updatedAt is the LWW comparison field. Stamp with the (capped) client
  // time when the caller provided one; otherwise let the DB stamp now.
  const stamp = cappedClientSeconds ?? nowSeconds;

  db.update(shoppingItem)
    .set({
      ...set,
      version: sql`${shoppingItem.version} + 1`,
      updatedAt: stamp,
    })
    .where(eq(shoppingItem.id, id))
    .run();
  const view = getItemView(id);
  if (!view) throw new ShoppingApiError("item not found", 404);
  return view;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/shopping.test.ts -t "patchItem LWW"`
Expected: PASS (5 tests).

Run: `npm run test -- tests/shopping.test.ts`
Expected: PASS for all `describe` blocks — the existing tests must still pass since `clientStampedAt` is optional.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shopping/items.ts tests/shopping.test.ts
git commit -m "feat(shopping): add client-timestamp LWW gate to patchItem

When an offline-queued toggle replays, server compares clientStampedAt to
the row's updatedAt and silently no-ops when the client mutation is older.
Caps the client timestamp at now() to prevent future-dated lockouts."
```

---

## Task 2: PATCH route accepts `clientStampedAt`

**Files:**
- Modify: `src/app/api/v1/shopping/items/[id]/route.ts`

- [ ] **Step 1: Update the route schema and pass-through**

Edit `src/app/api/v1/shopping/items/[id]/route.ts`. Replace `patchSchema` and the PATCH handler with:

```ts
const patchSchema = z
  .object({
    checked: z.boolean().optional(),
    note: z.string().nullable().optional(),
    mutationId: z.string().uuid().optional(),
    clientStampedAt: z.number().int().positive().optional(),
  })
  .strict();
```

In the handler body, change the destructuring and the `patchItem` call:

```ts
  const { mutationId, clientStampedAt, ...patch } = parsed.data;
  if (mutationId) {
    const cached = recallMutation<{ item: unknown }>(mutationId);
    if (cached) return NextResponse.json(cached);
  }
  try {
    const item = patchItem(id, patch, { clientStampedAt });
    const payload = { item };
    if (mutationId) recordMutation(mutationId, payload);
    publishShoppingChanged();
    return NextResponse.json(payload);
  } catch (err) { /* unchanged */ }
```

- [ ] **Step 2: Run a quick smoke test that the route module parses**

Run: `npm run typecheck`
Expected: PASS (zero TS errors).

Run: `npm run test -- tests/shopping.test.ts`
Expected: still PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/shopping/items/[id]/route.ts
git commit -m "feat(shopping): accept clientStampedAt on PATCH /items/:id

Threads the client timestamp into patchItem so offline replays go through
the LWW gate. Field is optional; online direct-call paths keep working."
```

---

## Task 3: Client `patchItem` API accepts `clientStampedAt`

**Files:**
- Modify: `src/components/shopping/api.ts:90-101`

- [ ] **Step 1: Update the API client signature**

Replace the `patchItem` function in `src/components/shopping/api.ts` with:

```ts
export async function patchItem(
  id: number,
  patch: {
    checked?: boolean;
    note?: string | null;
    mutationId?: string;
    clientStampedAt?: number;
  },
): Promise<ShoppingItemView> {
  const res = await fetch(`/api/v1/shopping/items/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = (await jsonOrThrow(res)) as { item: ShoppingItemView };
  return data.item;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/shopping/api.ts
git commit -m "feat(shopping): client patchItem accepts clientStampedAt"
```

---

## Task 4: Sync drain passes `clientStampedAt`

**Files:**
- Modify: `src/lib/shopping/offline/sync.ts:27-32`
- Test: `tests/shopping/offline-sync.test.ts` (new test added)

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("drainQueueOnce", …)` block in `tests/shopping/offline-sync.test.ts`:

```ts
  it("forwards clientStampedAt from queuedAt on the PATCH body", async () => {
    const db = await openOfflineDb();
    await db.put("items", makeItem({ id: 1 }));
    await db.put("mutationQueue", {
      mutationId: "m1", itemId: 1, type: "check", queuedAt: 42_000, attempts: 0,
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ item: makeItem({ id: 1, checked: true }) }),
        { status: 200, headers: { "content-type": "application/json" } }),
    );

    await drainQueueOnce();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body ?? "{}"));
    expect(body.clientStampedAt).toBe(42_000);
    expect(body.checked).toBe(true);
    expect(body.mutationId).toBe("m1");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/shopping/offline-sync.test.ts -t "forwards clientStampedAt"`
Expected: FAIL — current drain does not include `clientStampedAt` in the body.

- [ ] **Step 3: Update the drain**

Edit `src/lib/shopping/offline/sync.ts`. In `drainQueueOnce`, change the `apiPatchItem` call:

```ts
      const updated = await apiPatchItem(entry.itemId, {
        checked: entry.type === "check",
        mutationId: entry.mutationId,
        clientStampedAt: entry.queuedAt,
      });
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm run test -- tests/shopping/offline-sync.test.ts`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shopping/offline/sync.ts tests/shopping/offline-sync.test.ts
git commit -m "feat(shopping): drain passes queuedAt as clientStampedAt"
```

---

## Task 5: Refactor `hydrateFromIDB` — IDB is read-authoritative

**Files:**
- Modify: `src/lib/shopping/offline/store.ts:7-36`
- Test: `tests/shopping/offline-store.test.ts` (one new test, one existing test updated)

- [ ] **Step 1: Write the failing regression test**

Append inside the existing `describe("offline store", …)` block in `tests/shopping/offline-store.test.ts`:

```ts
  it("returns IDB items unchanged when called with an empty server seed", async () => {
    // Seed IDB with two items as if from a previous online visit.
    await hydrateFromIDB([
      makeItem({ id: 1, name: "Mehl" }),
      makeItem({ id: 2, name: "Zucker" }),
    ]);

    // Now simulate a cached-shell mount: serverSeed is empty.
    const items = await hydrateFromIDB([]);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id).sort()).toEqual([1, 2]);

    // IDB still has both rows — nothing was cleared.
    const db = await openOfflineDb();
    const stored = await db.getAll("items");
    expect(stored).toHaveLength(2);
  });

  it("returns IDB items unchanged when serverSeed is null", async () => {
    await hydrateFromIDB([makeItem({ id: 1 })]);
    const items = await hydrateFromIDB(null);
    expect(items).toHaveLength(1);
  });

  it("does not clobber a locally-newer item when given a stale server seed", async () => {
    // Seed once.
    await hydrateFromIDB([makeItem({ id: 1, checked: false })]);
    // User toggles it locally (writes to IDB + queue).
    await toggleItemOptimistic(1, true);

    // Cached SSR snapshot says it's still unchecked.
    const items = await hydrateFromIDB([makeItem({ id: 1, checked: false })]);
    expect(items[0].checked).toBe(true); // IDB-authoritative; pending overlay applied
  });
```

The existing test `"hydrates from an empty IDB into the provided server snapshot"` keeps its semantics — that's still the first-ever-visit seeding path.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test -- tests/shopping/offline-store.test.ts`
Expected: the existing 3 tests pass; the new "returns IDB items unchanged when called with an empty server seed" FAILS — current implementation clears IDB on every call.

- [ ] **Step 3: Rewrite `hydrateFromIDB`**

Edit `src/lib/shopping/offline/store.ts`. Replace the existing `hydrateFromIDB` function (lines 7–36) with:

```ts
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
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm run test -- tests/shopping/offline-store.test.ts`
Expected: PASS (all tests, including the three new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shopping/offline/store.ts tests/shopping/offline-store.test.ts
git commit -m "fix(shopping): hydrateFromIDB no longer clears IDB

IDB is now read-authoritative: returns local items with pending overlays
when IDB has data, only seeds from serverSeed when IDB is empty. Fixes
the empty-list-after-navigation bug where a cached SSR snapshot wiped
IDB on mount."
```

---

## Task 6: Add `reconcileFromServer`

**Files:**
- Modify: `src/lib/shopping/offline/store.ts` (append a new exported function)
- Test: `tests/shopping/offline-store.test.ts` (append a new `describe` block)

- [ ] **Step 1: Write the failing test**

Append a new `describe` block at the end of `tests/shopping/offline-store.test.ts`:

```ts
describe("reconcileFromServer", () => {
  beforeEach(async () => {
    await resetOfflineDbForTests();
  });

  it("replaces IDB with the server snapshot when there are no pending mutations", async () => {
    const db = await openOfflineDb();
    await db.put("items", makeItem({ id: 1, name: "stale" }));

    const { reconcileFromServer } = await import("@/lib/shopping/offline/store");
    const merged = await reconcileFromServer([
      makeItem({ id: 2, name: "Salz" }),
      makeItem({ id: 3, name: "Zucker" }),
    ]);
    expect(merged.map((i) => i.id).sort()).toEqual([2, 3]);

    const stored = await db.getAll("items");
    expect(stored.map((i) => i.id).sort()).toEqual([2, 3]);
  });

  it("overlays a pending toggle on top of the server snapshot", async () => {
    const db = await openOfflineDb();
    await db.put("items", makeItem({ id: 1, checked: true }));
    await db.put("mutationQueue", {
      mutationId: "m1",
      itemId: 1,
      type: "uncheck",
      queuedAt: 7_000,
      attempts: 0,
    });

    const { reconcileFromServer } = await import("@/lib/shopping/offline/store");
    // Server insists the item is still checked.
    const merged = await reconcileFromServer([
      makeItem({ id: 1, checked: true, checkedAt: 5 }),
    ]);
    // Pending uncheck wins until drained.
    expect(merged[0].checked).toBe(false);
    expect(merged[0].checkedAt).toBeNull();
  });

  it("updates meta.shoppingFetchedAt", async () => {
    const before = Date.now();
    const { reconcileFromServer } = await import("@/lib/shopping/offline/store");
    await reconcileFromServer([makeItem({ id: 1 })]);
    const db = await openOfflineDb();
    const meta = await db.get("meta", "shoppingFetchedAt");
    expect(meta).toBeDefined();
    expect(meta!.value).toBeGreaterThanOrEqual(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/shopping/offline-store.test.ts -t "reconcileFromServer"`
Expected: FAIL — `reconcileFromServer` does not exist yet.

- [ ] **Step 3: Implement `reconcileFromServer`**

Append to `src/lib/shopping/offline/store.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm run test -- tests/shopping/offline-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shopping/offline/store.ts tests/shopping/offline-store.test.ts
git commit -m "feat(shopping): add reconcileFromServer for post-online merge

Preserves pending toggles when the server snapshot lands after a
reconnect, replacing the previous \"hydrateFromIDB clears IDB\" path."
```

---

## Task 7: Connectivity gains a `"checking"` state with immediate probe

**Files:**
- Modify: `src/lib/shopping/offline/connectivity.ts`
- Test: `tests/shopping/connectivity.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `tests/shopping/connectivity.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("connectivity module", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initial state is 'checking', not 'online'", async () => {
    const mod = await import("@/lib/shopping/offline/connectivity");
    expect(mod.getConnectivity()).toBe("checking");
  });

  it("startConnectivityWatcher fires an immediate probe and flips to 'online' on success", async () => {
    const mod = await import("@/lib/shopping/offline/connectivity");
    // jsdom-less environment: stub window + document just enough.
    const listeners: Record<string, Array<() => void>> = {};
    vi.stubGlobal("window", {
      addEventListener: (k: string, fn: () => void) => {
        (listeners[k] ??= []).push(fn);
      },
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("navigator", { onLine: true });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const stop = mod.startConnectivityWatcher();
    // Yield to microtasks so the immediate probe resolves.
    await new Promise((r) => setTimeout(r, 0));
    expect(mod.getConnectivity()).toBe("online");
    stop();
  });

  it("flips to 'offline' immediately when navigator.onLine is false", async () => {
    const mod = await import("@/lib/shopping/offline/connectivity");
    vi.stubGlobal("window", {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("navigator", { onLine: false });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const stop = mod.startConnectivityWatcher();
    await new Promise((r) => setTimeout(r, 0));
    expect(mod.getConnectivity()).toBe("offline");
    expect(fetchSpy).not.toHaveBeenCalled(); // no probe when navigator says offline
    stop();
  });

  it("flips to 'offline' when the immediate probe rejects", async () => {
    const mod = await import("@/lib/shopping/offline/connectivity");
    vi.stubGlobal("window", {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("navigator", { onLine: true });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("net"));

    const stop = mod.startConnectivityWatcher();
    await new Promise((r) => setTimeout(r, 0));
    expect(mod.getConnectivity()).toBe("offline");
    stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/shopping/connectivity.test.ts`
Expected: FAIL — `initial state is 'checking'` fails because the current default is `"online"`; the probe-on-mount tests also fail because the current watcher only probes on visibility changes / heartbeats.

- [ ] **Step 3: Update the connectivity module**

Replace `src/lib/shopping/offline/connectivity.ts` in full:

```ts
export type ConnectivityState =
  | "checking"
  | "online"
  | "offline"
  | "syncing"
  | "sessionExpired";

type Listener = (state: ConnectivityState) => void;

let state: ConnectivityState = "checking";
const listeners = new Set<Listener>();

export function getConnectivity(): ConnectivityState {
  return state;
}

export function setConnectivity(next: ConnectivityState): void {
  if (next === state) return;
  state = next;
  for (const l of listeners) l(state);
}

export function subscribeConnectivity(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const HEARTBEAT_MS = 30_000;
let heartbeatHandle: ReturnType<typeof setInterval> | null = null;

async function pingHealth(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function startConnectivityWatcher(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onOnline = () => {
    // navigator says we're back — re-probe before declaring online.
    void runProbe();
  };
  const onOffline = () => setConnectivity("offline");
  const onVisibility = async () => {
    if (document.visibilityState !== "visible") return;
    if (state === "sessionExpired") return;
    await runProbe();
  };

  async function runProbe() {
    if (navigator.onLine === false) {
      setConnectivity("offline");
      return;
    }
    const ok = await pingHealth();
    if (state === "sessionExpired") return; // sticky until user re-auths
    setConnectivity(ok ? "online" : "offline");
  }

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisibility);

  // Pessimistic-by-default: probe immediately on mount so the chip is
  // honest within ~5s of every fresh page load. `navigator.onLine === false`
  // short-circuits to "offline" with no network call.
  void runProbe();

  heartbeatHandle = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (state === "sessionExpired") return;
    void runProbe();
  }, HEARTBEAT_MS);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisibility);
    if (heartbeatHandle) clearInterval(heartbeatHandle);
    heartbeatHandle = null;
  };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm run test -- tests/shopping/connectivity.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shopping/offline/connectivity.ts tests/shopping/connectivity.test.ts
git commit -m "fix(shopping): connectivity defaults to 'checking', probes on mount

Removes the optimistic 'online' default that lied to the chip on every
fresh page load. New 'checking' state covers the indeterminate window
until the immediate probe resolves; navigator.onLine === false
short-circuits to 'offline' without a network call."
```

---

## Task 8: Chip presentation for `"checking"`

**Files:**
- Modify: `src/components/shopping/offline-indicator.tsx:17-33`

- [ ] **Step 1: Update `chipPresentation`**

Replace the function body in `src/components/shopping/offline-indicator.tsx`:

```ts
export function chipPresentation(state: ConnectivityState, pending: number) {
  if (state === "sessionExpired") {
    return { dot: "bg-[var(--color-danger)]", icon: AlertTriangle, label: "Anmeldung abgelaufen" };
  }
  if (state === "offline") {
    const label = pending > 0 ? `Offline – ${pending} ausstehend` : "Offline";
    return { dot: "bg-[var(--color-muted-fg)]", icon: CloudOff, label };
  }
  if (state === "checking") {
    return {
      dot: "bg-[var(--color-muted-fg)]",
      icon: RefreshCw,
      label: "Prüfe Verbindung…",
    };
  }
  if (state === "syncing" || pending > 0) {
    return {
      dot: "bg-[var(--color-warning)]",
      icon: RefreshCw,
      label: `Synchronisiere${pending > 0 ? ` ${pending}` : ""}…`,
    };
  }
  return { dot: "bg-[var(--color-success)]", icon: Wifi, label: "Online" };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/shopping/offline-indicator.tsx
git commit -m "feat(shopping): chip shows 'Prüfe Verbindung…' during checking"
```

---

## Task 9: Realtime WS does not connect during `"checking"`

**Files:**
- Modify: `src/components/shopping/use-shopping-realtime.ts:23`

- [ ] **Step 1: Update the `shouldConnect` predicate**

In `src/components/shopping/use-shopping-realtime.ts`, change:

```ts
  // Don't bother connecting when offline or when the session is dead (the
  // upgrade would just 401-loop). Skip 'checking' too — wait for the probe
  // to confirm online before opening the WS handshake.
  const shouldConnect =
    state !== "offline" && state !== "sessionExpired" && state !== "checking";
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/shopping/use-shopping-realtime.ts
git commit -m "fix(shopping): defer WS connect until connectivity is confirmed"
```

---

## Task 10: ShoppingListView wires the new read-authoritative flow

**Files:**
- Modify: `src/components/shopping/shopping-list-view.tsx:68-157`

- [ ] **Step 1: Drop the `[initialItems]`-keyed setItems and add reconcile imports**

In `src/components/shopping/shopping-list-view.tsx`:

1. Remove the import of `hydrateFromIDB` and re-import together with the new function:

```ts
import {
  hydrateFromIDB,
  readPendingQueue,
  reconcileFromServer,
  toggleItemOptimistic,
} from "@/lib/shopping/offline/store";
```

2. Replace lines 68–70 (the state init plus the `[initialItems]` effect) with:

```ts
  const [items, setItems] = React.useState(initialItems);
  // NOTE: we deliberately do NOT re-sync `items` from `initialItems` on
  // every render. IDB is the source of truth on the client; treating
  // `initialItems` as authoritative would let a cached SSR snapshot (e.g.,
  // the data-less offline shell) overwrite live local state. The mount
  // effect below seeds IDB from `initialItems` only when IDB is empty.
```

3. Replace the realtime callback's `setItems(fresh)` line so that after a refetch we go through `reconcileFromServer`:

```ts
  useShoppingRealtime(
    React.useCallback(async () => {
      try {
        const { items: fresh } = await fetchItems();
        const merged = await reconcileFromServer(fresh);
        setItems(merged);
      } catch {
        // Transient — connectivity watcher will flip if it's real.
      }
    }, []),
  );
```

4. Replace the mount-effect (currently lines 119–139). The `await kickSync()` previously gated on `navigator.onLine`; replace with a check that the *connectivity store* reads `"online"`:

```ts
  // Mount: hydrate UI from IDB, mirror supermarkets cache, then attempt
  // a sync drain only if connectivity has already resolved to online.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const merged = await hydrateFromIDB(initialItems);
      if (cancelled) return;
      setItems(merged);
      const db = await openOfflineDb();
      const wtx = db.transaction(["supermarkets"], "readwrite");
      await wtx.objectStore("supermarkets").clear();
      for (const s of supermarkets) await wtx.objectStore("supermarkets").put(s);
      await wtx.done;
      const q = await readPendingQueue();
      if (!cancelled) setPendingCount(q.length);
      if (getConnectivity() === "online") await kickSync();
      const q2 = await readPendingQueue();
      if (!cancelled) setPendingCount(q2.length);
    })().catch((err) => console.warn("offline init failed", err));
    return () => {
      cancelled = true;
    };
    // `initialItems` and `supermarkets` are SSR-stable per page load; we run
    // this once on mount even though they're in the dep list.
  }, [initialItems, supermarkets]);
```

5. Replace the `[connectivity]` effect (lines 144–157) with a previous-state guard so we reconcile only on a real transition into online:

```ts
  const prevConnectivityRef = React.useRef(connectivity);
  React.useEffect(() => {
    const prev = prevConnectivityRef.current;
    prevConnectivityRef.current = connectivity;
    if (connectivity !== "online") return;
    if (prev === "online") return; // not a transition
    void (async () => {
      try {
        const { items: fresh } = await fetchItems();
        const merged = await reconcileFromServer(fresh);
        setItems(merged);
      } catch {
        // Probe says online but the request failed; the watcher will flip
        // us back on the next probe.
      }
      await kickSync();
      const q = await readPendingQueue();
      setPendingCount(q.length);
    })();
  }, [connectivity]);
```

- [ ] **Step 2: Verify typecheck and existing tests still pass**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test`
Expected: PASS (full suite — none of the existing tests render this component, but the touched modules must still pass their unit tests).

- [ ] **Step 3: Commit**

```bash
git add src/components/shopping/shopping-list-view.tsx
git commit -m "fix(shopping): /einkauf renders from IDB, reconciles on online transition

Removes the [initialItems]-keyed setItems that let a cached SSR snapshot
wipe live local state. Adds a previous-state guard so reconcile fires
only on a real offline→online (or checking→online) transition, never on
spurious initial-render 'online' states."
```

---

## Task 11: Bug-class regression test — offline navigation preserves IDB

**Files:**
- Create: `tests/shopping/offline-navigation.test.ts`

- [ ] **Step 1: Write the regression test**

Create `tests/shopping/offline-navigation.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import {
  resetOfflineDbForTests,
  openOfflineDb,
} from "@/lib/shopping/offline/db";
import {
  hydrateFromIDB,
  toggleItemOptimistic,
} from "@/lib/shopping/offline/store";
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

describe("offline navigation regression — IDB survives the cached shell mount", () => {
  beforeEach(async () => {
    await resetOfflineDbForTests();
  });

  it("does not wipe IDB when the page mounts with an empty initialItems (offline shell case)", async () => {
    // Simulate a previous online visit that populated IDB.
    await hydrateFromIDB([
      makeItem({ id: 1, name: "Mehl" }),
      makeItem({ id: 2, name: "Salz" }),
      makeItem({ id: 3, name: "Zucker" }),
    ]);

    // Simulate the user toggling one item while offline.
    await toggleItemOptimistic(2, true);

    // Now the user navigates to /einkauf via the SW-cached data-less shell.
    // initialItems === [] because the cached shell carried no data.
    const merged = await hydrateFromIDB([]);

    expect(merged).toHaveLength(3);
    expect(merged.find((i) => i.id === 2)?.checked).toBe(true);

    // IDB still holds all three rows and the queued mutation.
    const db = await openOfflineDb();
    expect(await db.getAll("items")).toHaveLength(3);
    expect(await db.getAll("mutationQueue")).toHaveLength(1);
  });

  it("does not wipe IDB when the page mounts with null initialItems", async () => {
    await hydrateFromIDB([makeItem({ id: 1 }), makeItem({ id: 2 })]);
    const merged = await hydrateFromIDB(null);
    expect(merged).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes against the new code**

Run: `npm run test -- tests/shopping/offline-navigation.test.ts`
Expected: PASS — both tests rely on the Task 5 changes to `hydrateFromIDB`.

- [ ] **Step 3: Commit**

```bash
git add tests/shopping/offline-navigation.test.ts
git commit -m "test(shopping): regression for the cached-shell IDB-wipe bug"
```

---

## Task 12: `/einkauf` page reads `X-Nomly-Shell` header

**Files:**
- Modify: `src/app/einkauf/page.tsx`

- [ ] **Step 1: Read the header and skip the items query when set**

Replace the body of `src/app/einkauf/page.tsx`:

```tsx
import { headers } from "next/headers";
import { ShoppingListView } from "@/components/shopping/shopping-list-view";
import { listShoppingItems } from "@/lib/shopping/items";
import {
  getSupermarketDetail,
  listSupermarkets,
} from "@/lib/stammdaten/supermarket/service";
import { nextStartWeekdayOnOrAfter, todayIso } from "@/lib/meal-plans/dates";
import { getPlannerSettings } from "@/lib/settings/planner";

export const dynamic = "force-dynamic";

export default async function ShoppingPage() {
  const requestHeaders = await headers();
  const isShellPrecache = requestHeaders.get("x-nomly-shell") === "1";

  // The SW pre-caches /einkauf once at install with `X-Nomly-Shell: 1`.
  // That cached shell carries no items so it can never clobber IDB on an
  // offline navigation. Online navigations come through as a normal
  // request and get the full list.
  const items = isShellPrecache ? [] : listShoppingItems();
  const supermarketList = listSupermarkets();
  const supermarkets = supermarketList
    .map((s) => getSupermarketDetail(s.id))
    .filter((s): s is NonNullable<typeof s> => s != null)
    .map((s) => ({
      id: s.id,
      name: s.name,
      categories: s.orderedCategories.map((c) => ({
        categoryId: c.categoryId,
        sortOrder: c.sortOrder,
      })),
    }));
  const planner = getPlannerSettings();
  const today = todayIso();
  const defaultStart = nextStartWeekdayOnOrAfter(today, planner.startWeekday);
  return (
    <ShoppingListView
      initialItems={items}
      supermarkets={supermarkets}
      defaultLengthDays={planner.daysVisible}
      defaultStart={defaultStart}
    />
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/einkauf/page.tsx
git commit -m "feat(einkauf): skip items query when SW requests a data-less shell"
```

---

## Task 13: Service worker pre-caches the data-less shell and drops the shopping data cache

**Files:**
- Modify: `public/sw.js`
- Modify: `src/components/pwa/register-sw.tsx` (sends a refresh-shell message after mount)

The SW does its own pre-cache attempt at install time, but that fetch can fail if the user isn't signed in when the SW first installs. To make the cached shell warm in steady state, the `/einkauf` page also asks the SW (via `postMessage`) to refresh its cached shell — the page is only rendered for an authenticated user, so the fetch is guaranteed to carry a live session.

- [ ] **Step 1: Update the SW install + fetch handlers**

Replace `public/sw.js` in full:

```js
// nomly service worker — local-first offline shell.
// - Pre-caches a data-less /einkauf shell at install time via the
//   X-Nomly-Shell header. The cached shell never contains live items, so
//   navigating to /einkauf while offline can no longer clobber IDB.
// - Caches static assets + supermarket/category data only. The shopping
//   list itself is owned by IndexedDB on the client.

const CACHE_VERSION = "v3";
const SHELL_CACHE  = `nomly-shell-${CACHE_VERSION}`;
const DATA_CACHE   = `nomly-data-${CACHE_VERSION}`;
const STATIC_CACHE = `nomly-static-${CACHE_VERSION}`;
const ALL_CACHES   = new Set([SHELL_CACHE, DATA_CACHE, STATIC_CACHE]);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);

    // Pre-cache the data-less /einkauf shell. The server returns
    // initialItems=[] when this header is present. `redirect: "error"`
    // makes the fetch throw (instead of caching the login page) when the
    // user isn't signed in at install time — the page re-triggers a
    // refresh via postMessage on first mount once we know the session is
    // live, see REFRESH_SHELL handler below.
    try {
      const shellRes = await fetch("/einkauf", {
        cache: "no-store",
        redirect: "error",
        headers: { "X-Nomly-Shell": "1" },
      });
      if (shellRes.ok) await cache.put("/einkauf", shellRes.clone());
    } catch (e) {
      console.warn("[sw] shell pre-cache failed", e);
    }

    // Pre-cache static asset list from the build manifest.
    try {
      const res = await fetch("/sw-precache.json", { cache: "no-store" });
      if (res.ok) {
        const { shell = [], assets = [] } = await res.json();
        await cache.addAll([...shell, ...assets].filter(Boolean));
      }
    } catch (e) {
      console.warn("[sw] precache manifest failed", e);
    }

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith("nomly-") && !ALL_CACHES.has(n))
        .map((n) => caches.delete(n)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (event.data === "REFRESH_SHELL") {
    event.waitUntil((async () => {
      try {
        const res = await fetch("/einkauf", {
          cache: "no-store",
          redirect: "error",
          headers: { "X-Nomly-Shell": "1" },
        });
        if (res.ok) {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put("/einkauf", res.clone());
        }
      } catch (e) {
        console.warn("[sw] shell refresh failed", e);
      }
    })());
  }
});

// Note: /api/v1/shopping is intentionally NOT cached. The client reads
// shopping data from IndexedDB; caching the API would let stale responses
// clobber IDB on an "online" probe blip.
const DATA_PATHS = ["/api/v1/supermarkets", "/api/v1/categories"];
function isDataPath(url) {
  return DATA_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"));
}
function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}
function isShellNavigation(req, url) {
  return req.mode === "navigate" && url.pathname === "/einkauf";
}
function isNavigation(req) {
  return req.mode === "navigate";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isShellNavigation(req, url)) {
    event.respondWith(shellNavigationStrategy(req));
    return;
  }
  if (isNavigation(req)) {
    event.respondWith(navigationFallbackStrategy(req));
    return;
  }
  if (isDataPath(url)) {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }
});

async function shellNavigationStrategy(req) {
  // Live navigations pass through to the network for fresh data. The
  // cached shell (data-less, owned by `install`) is served only as an
  // offline fallback — we deliberately do NOT cache.put the live
  // response, because that would re-introduce the "cached SSR snapshot
  // carries baked-in items" bug.
  try {
    return await fetch(req);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match("/einkauf");
    if (cached) return cached;
    const offline = await cache.match("/offline");
    if (offline) return offline;
    return new Response(
      "<!doctype html><meta charset=utf-8><title>nomly offline</title><p>Offline — Einkaufsliste konnte nicht geladen werden. Öffne die Seite einmal online, dann steht sie auch offline bereit.</p>",
      { headers: { "content-type": "text/html;charset=utf-8" }, status: 503 },
    );
  }
}

async function navigationFallbackStrategy(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    return await fetch(req);
  } catch {
    const offline = await cache.match("/offline");
    if (offline) return offline;
    return new Response(
      "<!doctype html><meta charset=utf-8><title>nomly offline</title><p>Offline.</p>",
      { headers: { "content-type": "text/html;charset=utf-8" }, status: 503 },
    );
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
```

- [ ] **Step 2: Have the page nudge the SW to refresh the cached shell after mount**

The install-time pre-cache fails if the user isn't signed in at install time. The page knows it's authenticated (it just rendered for the user), so it can ask the SW to retry the pre-cache from a known-good session.

Edit `src/components/pwa/register-sw.tsx`. After the `.then((reg) => { … })` block (which is currently the only side-effect of registration), append a one-shot postMessage on `/einkauf` mount.

The cleanest place for this nudge is inside `register-sw.tsx`'s registration callback: after we have `reg`, also check `navigator.serviceWorker.controller` and post `REFRESH_SHELL` when the current path is `/einkauf`. Concretely, modify the registration handler:

```tsx
navigator.serviceWorker
  .register("/sw.js", { scope: "/" })
  .then((reg) => {
    if (cancelled) return;
    registration = reg;
    reg.addEventListener("updatefound", () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          window.dispatchEvent(new CustomEvent("nomly:sw-update-available"));
        }
      });
    });
    reg.update().catch(() => undefined);
    document.addEventListener("visibilitychange", checkForUpdate);

    // Warm the offline shell from a known-authenticated context. Fires
    // only when the user is actually on /einkauf so we don't churn the
    // cache for unrelated routes. Safe to fire on every mount — the SW
    // handler dedupes via no-store fetch semantics and serves identical
    // bytes when nothing changed.
    if (
      window.location.pathname === "/einkauf"
      && navigator.serviceWorker.controller
    ) {
      navigator.serviceWorker.controller.postMessage("REFRESH_SHELL");
    }
  })
  .catch((err) => console.warn("[sw] registration failed", err));
```

- [ ] **Step 3: Commit**

(SW changes have no Vitest coverage; verification happens in Task 14.)

```bash
git add public/sw.js src/components/pwa/register-sw.tsx
git commit -m "fix(sw): pre-cache data-less /einkauf shell, drop shopping data cache

The cached shell is seeded once at install via the X-Nomly-Shell header
and never overwritten by live fetches. Removes /api/v1/shopping from
the data cache so a stale cached response can no longer race the IDB
hydration. The /einkauf page also posts REFRESH_SHELL to the SW on
mount so the cached shell is warmed from a known-authenticated context
(fixes the case where install-time pre-cache hit an auth redirect).
CACHE_VERSION bumped to v3 to evict v2 entries."
```

---

## Task 14: Final verification

**Files:** none — verification only.

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: PASS. No tests are skipped or marked todo.

- [ ] **Step 2: Type check**

Run: `npm run typecheck`
Expected: PASS, zero errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Manual smoke in a browser**

The SW only registers in production builds (`register-sw.tsx:7`). For the manual checklist:

```bash
npm run build && npm run start
```

In Chrome DevTools → Application:

1. **First-paint correctness (online).** Open `/einkauf` online with a populated list. Chip flickers `"Prüfe Verbindung…"` (≤ 5s), then `"Online"`. Items render.
2. **Bug-class repro (offline navigation).** With the same list, switch DevTools → Network → "Offline". Navigate `/einkauf` → `/plan` → `/einkauf`. Items must remain visible. Chip must NOT flash green; it should go `"Prüfe Verbindung…"` → `"Offline"`.
3. **Offline toggle + reconnect drain.** While offline, check 2–3 items. Pending counter increments. Switch Network back to "No throttling". Chip flips to `"Synchronisiere n…"` then `"Online"`. Pending counter drops to 0.
4. **LWW newest-wins.** Open `/einkauf` in two tabs. Tab A: switch offline. Tab A: uncheck item X (was checked). Tab B (still online): check item X at a fresh timestamp. Tab A: switch online. Tab A's drain replays — server rejects the stale uncheck; Tab A's UI flips back to "checked".
5. **`sessionExpired` is still sticky.** Sign out via a second window, then in the original window toggle an item. Chip flips to `"Anmeldung abgelaufen"` and stays there until you sign back in.

If any of the five smoke checks fail, capture the discrepancy and fix before moving on — none of them should regress.

- [ ] **Step 5: Final commit (if any tweaks needed during smoke)**

If smoke surfaced any small fix, commit it. Otherwise, this task ends without a commit.

---

## Self-review checklist (for the executing agent)

Before declaring done:

- All 14 tasks ticked, every checkbox checked.
- `npm run test` is green at the tip of the branch.
- `npm run typecheck` is green.
- `git log --oneline` shows a per-task commit history.
- A spot-check of `src/components/shopping/shopping-list-view.tsx` confirms the old `React.useEffect(() => setItems(initialItems), [initialItems])` is gone and not replaced with an equivalent pattern.
- `public/sw.js` `CACHE_VERSION` reads `"v3"` and `DATA_PATHS` does NOT include `/api/v1/shopping`.
- `src/lib/shopping/offline/connectivity.ts` initial `state` is `"checking"` and `runProbe()` is invoked synchronously from `startConnectivityWatcher`.
