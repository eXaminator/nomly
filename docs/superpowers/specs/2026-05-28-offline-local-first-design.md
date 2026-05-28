# Offline shopping list — local-first redesign

- **Date:** 2026-05-28
- **Status:** Design approved
- **Owner:** Steven Weingärtner
- **Supersedes / refines:** §§ 7–9 of `docs/superpowers/specs/2026-05-26-epic-8-pwa-offline-design.md`. Scope, manifest, icon family, and service-worker shape from that spec carry over unchanged except where called out below.

## 1. Purpose

Make `/einkauf` behave like a local-first app: IndexedDB is the source of truth on the client, network is a sync target, and the connectivity indicator never lies about being online. Fix two concrete bugs the user hits in flight mode:

1. Navigating between pages occasionally flips the chip to "online" (green) while the device is offline, and clobbers the shopping list with an empty / stale snapshot.
2. Toggles made while offline are not always replayed cleanly on reconnect, and conflict semantics with the second user are unspecified.

## 2. Scope

### 2.1 In scope

- New IDB hydration semantics: IDB is read-authoritative on every mount; SSR data is only a seed when IDB is empty.
- New connectivity model: pessimistic-by-default with an explicit `checking` state; honest signalling during the indeterminate window after a fresh page load.
- Service worker `/einkauf` shell strategy reshape: cache an empty, data-less shell so it cannot inject stale items.
- Mutation envelope gains a `clientStampedAt` field; server-side last-write-wins gate keyed on `shopping_item.updatedAt`.
- Drain pipeline merges server responses into IDB without clearing pending rows.

### 2.2 Out of scope

- Expanding the offline mutation surface. Add / edit-qty / edit-note / delete / clear-list / add-meals remain online-only; their controls keep their current disabled-when-offline behaviour.
- Offline access to recipes, planner, settings. Those pages remain online-first.
- Replacing the realtime transport (still WS `/ws` shopping topic per Epic 9).
- Background Sync API. iOS Safari doesn't support it and our event-driven drain path is sufficient.

## 3. Why the current implementation breaks

Three independent design choices compound into the observed bug class:

1. **Connectivity state defaults to `"online"` at module init.** `src/lib/shopping/offline/connectivity.ts:9` declares `let state: ConnectivityState = "online";`. On every fresh page load (and every navigation the SW intercepts to serve a cached shell is a fresh page load), the in-memory state resets to that optimistic default. Only `navigator.onLine === false` flips it; otherwise the chip is green until the next heartbeat fires.
2. **`hydrateFromIDB(serverItems)` clears the IDB items store before refilling from the SSR snapshot** (`src/lib/shopping/offline/store.ts:11–18`). When the SW serves a cached `/einkauf` shell whose baked-in `initialItems` is empty or stale (because that's what was on the list the last time the shell was network-fetched), IDB is wiped on mount and replaced with that empty/stale state.
3. **The `[connectivity]`-keyed effect refetches and overwrites items whenever state reads `"online"`** (`src/components/shopping/shopping-list-view.tsx:144–157`). Combined with point 1, this fires on first paint while offline because the chip's default lies. The fetch hits the SW's network-first cache for `/api/v1/shopping`; if the cache contains an older / empty response, `setItems(fresh)` clobbers the just-hydrated IDB state.

The fix targets each of the three.

## 4. Architecture

### 4.1 Read path — IDB is authoritative

A single rule: **the React state for the shopping list is always derived from IDB, never from `initialItems` directly.** SSR may still produce `initialItems` (for the first-ever visit case, where IDB is empty and we want a non-blank first paint), but they are treated as a seed for IDB, not as a source for the UI.

New hydration contract in `src/lib/shopping/offline/store.ts`:

```ts
// Read-authoritative hydration. Called from /einkauf mount.
//   - If IDB has any items, return them with pending mutations overlaid.
//   - If IDB is empty AND serverSeed is non-empty, write serverSeed into
//     IDB and return it. This is the first-ever-visit case.
//   - If both are empty, return [].
// Never clears IDB. Never lets serverSeed override local rows.
export async function hydrateFromIDB(
  serverSeed: ShoppingItemView[] | null,
): Promise<ShoppingItemView[]>;

// Server reconciliation. Called only after a successful online probe.
//   - Replaces IDB items with serverItems, preserving rows that have a
//     pending toggle in mutationQueue (the queued toggle wins until drained).
//   - Updates meta.shoppingFetchedAt.
export async function reconcileFromServer(
  serverItems: ShoppingItemView[],
): Promise<ShoppingItemView[]>;
```

The page's `useEffect` chain changes shape:

1. On mount: call `hydrateFromIDB(initialItems)`, `setItems(...)`. This is the only place SSR data may seed IDB.
2. On `offline → online` transition (not on every render, not on `checking → online`): call `fetchItems()` → `reconcileFromServer(fresh)` → `setItems(...)` → `kickSync()`.
3. On WS `shopping` event while online: same as step 2.

The `React.useEffect(() => setItems(initialItems), [initialItems])` block at `src/components/shopping/shopping-list-view.tsx:70` is **removed**. It served Next.js's "props changed on RSC refresh" case, but with IDB as the source of truth there is no reason for `initialItems` to overwrite live state mid-session.

### 4.2 Connectivity model — pessimistic by default

`ConnectivityState` gains a fourth value:

```ts
export type ConnectivityState =
  | "checking"      // NEW — initial state until first probe resolves
  | "online"
  | "offline"
  | "sessionExpired";
```

`src/lib/shopping/offline/connectivity.ts` changes:

- Module init: `let state: ConnectivityState = "checking";`.
- `startConnectivityWatcher()` runs an immediate probe synchronously after mount (no waiting for the first heartbeat tick or visibility change). The probe is the existing `pingHealth()` call (`HEAD /api/health`, 5s timeout).
- Short-circuit before the probe: if `navigator.onLine === false`, set state to `"offline"` and skip the probe.
- Probe success → `"online"`. Probe failure → `"offline"`. Either way, the indeterminate `"checking"` state is bounded to ~0–5 seconds.

Chip presentation for `"checking"` (`src/components/shopping/offline-indicator.tsx:chipPresentation`):

- Muted/neutral dot (gray, same swatch as `offline` but distinguishable).
- Icon: `RefreshCw` (spinning).
- Label: `"Prüfe Verbindung…"`.
- Treated by all `disabledOffline` consumers as **non-offline** — buttons stay enabled. Treated by the refetch effect as **not online** — no premature fetch fires.

Rationale: showing a spinner briefly is honest and matches the user's intent ("local first, user shouldn't notice the connection is bad"). The shopping list itself paints instantly from IDB during this window — only the chip is in transition.

`disabledOffline` consumers in `shopping-list-view.tsx` change:

```ts
// Before:
const disabledOffline =
  connectivity === "offline" || connectivity === "sessionExpired";

// After:
const offlineLike =
  connectivity === "offline" || connectivity === "sessionExpired";
const disabledOffline = offlineLike; // identical behaviour; "checking" treated as online for UX
```

(The variable rename is cosmetic; the semantics — buttons disabled only in `offline` / `sessionExpired` — are preserved.)

The `[connectivity]`-keyed refetch effect adds a guard:

```ts
const prevRef = React.useRef<ConnectivityState>(connectivity);
React.useEffect(() => {
  const prev = prevRef.current;
  prevRef.current = connectivity;
  // Only refetch on a real offline→online (or checking→online) transition.
  if (connectivity !== "online") return;
  if (prev === "online") return; // already online, no transition
  void reconcileAfterOnline();
}, [connectivity]);
```

This kills the spurious refetch on mount when state happens to be `"online"` for unrelated reasons.

### 4.3 Service worker — data-less shell

`public/sw.js`'s `shellNavigationStrategy` (lines 87–106) is changed so the cached `/einkauf` HTML never carries baked-in shopping items. Two ways to achieve this:

**Approach: the SW pre-caches a data-less shell at install time; live navigations bypass the cache for response capture.**

- Keep the page server-rendered (still `force-dynamic`) so supermarkets and planner settings remain SSR-baked. The page reads a request header to decide whether to fetch the items list.
- `src/app/einkauf/page.tsx` reads the `X-Nomly-Shell` header via `next/headers`. When present and equal to `"1"`, it passes `initialItems={[]}` to `<ShoppingListView />` without calling `listShoppingItems()`. Saves DB work in the bargain.
- The SW's `install` step fetches `/einkauf` once with `headers: { "X-Nomly-Shell": "1" }` and stores the response under cache key `"/einkauf"` in `SHELL_CACHE`. This is the offline shell.
- `shellNavigationStrategy` no longer overwrites the cached shell on successful live fetches. The cached shell is owned by the install step; live navigations return fresh from the network without `cache.put`. Offline navigations return the cached (data-less) shell:

```js
async function shellNavigationStrategy(req) {
  try {
    return await fetch(req);             // live: pass through, do not cache
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match("/einkauf"))
        ?? (await cache.match("/offline"))
        ?? new Response("…", { status: 503 });
  }
}
```

Trade-off: the live-online first paint still renders items (no regression). The cached-offline first paint renders zero items, which is then replaced by the IDB read in the client mount effect — IDB read latency is sub-frame in practice, so no visible empty flash. If a flash is observed in practice the page can render a small skeleton while `hydrateFromIDB` resolves.

If even that flash is unacceptable, fall back to: the cached shell renders a "lädt…" skeleton row count derived from `meta.shoppingFetchedAt` presence in IDB (read synchronously from a `<script>` tag — out of scope here; skeleton is good enough).

The SW's data-cache for `/api/v1/shopping` is **removed entirely**. The page never fetches that endpoint until connectivity has transitioned to `"online"`, and at that point we want fresh network data, not cached. Removing the cache eliminates the third leak (stale cached API responses clobbering IDB). Categories and supermarkets stay cached (their values are needed by the filter and change rarely).

`DATA_PATHS` in `public/sw.js:46`:

```js
// Before:
const DATA_PATHS = ["/api/v1/shopping", "/api/v1/supermarkets", "/api/v1/categories"];
// After:
const DATA_PATHS = ["/api/v1/supermarkets", "/api/v1/categories"];
```

`CACHE_VERSION` bumps to `"v3"` so the obsolete `nomly-data-v2` cache is cleaned up on `activate`.

### 4.4 Mutation envelope — client-stamped LWW

`mutationQueue` entries gain no new fields — `queuedAt` already carries the client-side timestamp (ms epoch, `src/lib/shopping/offline/store.ts:46`). The wire format sent to the server changes:

```ts
// Before:
PATCH /api/v1/shopping/items/:id
{ checked: boolean, mutationId: string }

// After:
PATCH /api/v1/shopping/items/:id
{ checked: boolean, mutationId: string, clientStampedAt: number }
//                                       ^ ms epoch, equals queuedAt
```

`clientStampedAt` is **optional**. When absent (e.g., a direct online toggle that bypasses the queue — `apiPatch(id, { checked: false })` in `onUndoLastCheck` and similar paths), the server applies the patch unconditionally as today.

Server-side change in `src/app/api/v1/shopping/items/[id]/route.ts` and `src/lib/shopping/items.ts:patchItem`:

```ts
// patchSchema adds:
clientStampedAt: z.number().int().positive().optional(),

// patchItem signature gains an optional clientStampedAt (ms epoch).
// When provided AND the patch touches `checked`:
//   - Read the row's current updatedAt (unix seconds).
//   - Convert clientStampedAt to seconds: ts = Math.floor(clientStampedAt / 1000).
//   - If ts < current.updatedAt: skip the write. Return the current view
//     unchanged. This is the "stale offline replay loses to fresher server
//     state" branch.
//   - Else: apply, but stamp:
//        updatedAt = max(ts, unixepoch())
//        checkedAt = patch.checked ? max(ts, unixepoch()) : null
//     The max(...) guard prevents a client with a future-dated clock from
//     locking the row against legitimate later mutations.
```

The mutationId-LRU dedup cache (`src/lib/shopping/offline/mutation-dedup.ts`) keeps its current behaviour: when the same `mutationId` is replayed, the cached response is returned verbatim. Combined with LWW: a stale replay that lost to a fresher server state will cache the "no-op return current item" response, so further retries of the same mutationId are silent.

`note` patches are not affected by LWW. They're online-only and the server keeps applying them unconditionally (the existing "client clicked save" semantics).

The drain path (`drainQueueOnce` in `src/lib/shopping/offline/sync.ts`) is updated to:

```ts
const updated = await apiPatchItem(entry.itemId, {
  checked: entry.type === "check",
  mutationId: entry.mutationId,
  clientStampedAt: entry.queuedAt,
});
```

When the server returns a "loser" outcome (current state unchanged, because the mutation was stale), the drain still treats it as success — the queue entry is removed and IDB is overwritten with the authoritative row from the server. The UI flickers back to whatever the second device set; that is the correct behaviour for "newest wins".

### 4.5 Reconciliation — preserve pending toggles

`reconcileFromServer(serverItems)` (replacing today's `hydrateFromIDB(serverItems)` second-stage clearing-replace logic):

```ts
async function reconcileFromServer(items: ShoppingItemView[]): Promise<ShoppingItemView[]> {
  const db = await openOfflineDb();
  const queueEntries = await db.getAll("mutationQueue");
  const pendingById = new Map(queueEntries.map(e => [e.itemId, e] as const));

  const tx = db.transaction(["items", "meta"], "readwrite");
  await tx.objectStore("items").clear();
  const merged: ShoppingItemView[] = [];
  for (const item of items) {
    const pending = pendingById.get(item.id);
    if (pending) {
      // A queued toggle outranks the server snapshot for this item.
      const overlay: ShoppingItemView = {
        ...item,
        checked: pending.type === "check",
        checkedAt: pending.type === "check"
          ? Math.floor(pending.queuedAt / 1000)
          : null,
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

Note the difference vs today's `hydrateFromIDB`: this is called **only after** a confirmed `offline → online` transition, never on mount, never from cached SSR data. Items that exist locally but not on the server snapshot are dropped (the server is authoritative for the set of rows once we're truly online); items with pending toggles keep their pending state.

## 5. File-level changes

| File | Change |
|---|---|
| `src/lib/shopping/offline/connectivity.ts` | Add `"checking"` state; default `state = "checking"`; immediate probe on watcher mount. |
| `src/lib/shopping/offline/store.ts` | Rewrite `hydrateFromIDB` per §4.1; add `reconcileFromServer` per §4.5. |
| `src/lib/shopping/offline/sync.ts` | Pass `clientStampedAt: entry.queuedAt` to `apiPatchItem`. |
| `src/components/shopping/api.ts` | `patchItem` signature accepts `clientStampedAt?: number`. |
| `src/components/shopping/shopping-list-view.tsx` | Remove the `[initialItems]`-keyed `setItems`. Update the `[connectivity]` effect with the previous-state guard. Replace second-stage refetch flow to call `reconcileFromServer` instead of re-running hydrate. |
| `src/components/shopping/offline-indicator.tsx` | Add `chipPresentation` branch for `"checking"`. |
| `src/components/shopping/use-shopping-realtime.ts` | `shouldConnect` already excludes `offline`/`sessionExpired`; also exclude `"checking"` (don't open the WS until connectivity is confirmed). |
| `src/app/einkauf/page.tsx` | Read the `X-Nomly-Shell` header; when present, pass `initialItems={[]}`. |
| `src/lib/shopping/items.ts` | `listShoppingItems` is unchanged. Header handling lives in the page. |
| `src/app/api/v1/shopping/items/[id]/route.ts` | `patchSchema` accepts `clientStampedAt`. Pass it down to `patchItem`. |
| `src/lib/shopping/items.ts:patchItem` | Add `clientStampedAt?: number` parameter; LWW gate when present and `checked` is in the patch. |
| `public/sw.js` | `CACHE_VERSION = "v3"`. `DATA_PATHS` drops `/api/v1/shopping`. Shell precache adds `X-Nomly-Shell: 1` header. |
| `tests/...` | New tests per §7. |

No new dependencies. No database migration (LWW reuses the existing `updatedAt` column).

## 6. Migration and rollout

- The SW `CACHE_VERSION` bump from `v2` to `v3` triggers cache eviction on first navigation after deploy. Users with a stale `v2` data cache will see one extra network call to repopulate; no user-visible regression.
- The IDB schema is unchanged (still version 1). Existing rows continue to work; the new code reads from them on first mount.
- The `clientStampedAt` field is optional on the wire; the deploy is one-shot (no protocol negotiation needed). Old clients (no field) keep working — the server applies them unconditionally, same as today.
- No data migration. The sweeper job is unaffected.

Rollback path: revert the deploy. The `v3` caches are discarded; the previous `v2` SW re-installs. IDB rows survive. The only side effect is that any queued mutation already drained under v3 with LWW will have been recorded with `mutationId` in the dedup cache — that cache is in-memory only, so a rollback effectively loses no client state.

## 7. Testing

### 7.1 Reproducing the bug class

A failing integration test that proves the current bug exists:

```ts
// tests/shopping/offline-page-navigation.spec.ts
test("navigating away and back while offline preserves IDB items", async () => {
  // Seed IDB with three items via the toggle path while online.
  // Flip navigator.onLine and the connectivity store to "offline".
  // Render <ShoppingListView initialItems={[]} ... /> (simulates the cached shell).
  // Expect the rendered list to still show the three items (from IDB), not empty.
});
```

This fails on the current `main` (the empty `initialItems` clobbers IDB via `setItems(initialItems)` and / or the post-hydrate clear). It passes after §4.1.

### 7.2 Connectivity model

- `"checking"` is the initial state, no module-level optimism.
- `navigator.onLine === false` short-circuits the probe and yields `"offline"` immediately.
- Probe success transitions `"checking" → "online"`; failure transitions `"checking" → "offline"`.
- A `checking → online` transition fires the reconcile effect exactly once; a `online → online` re-render does not.

### 7.3 LWW server gate

- Toggle with `clientStampedAt < row.updatedAt` returns the current row unchanged; row is not written.
- Toggle with `clientStampedAt >= row.updatedAt` applies; `updatedAt = max(ts, unixepoch())`.
- Future-dated `clientStampedAt` (clock-skewed client) is capped: `updatedAt = unixepoch()`, not the future timestamp.
- Toggle without `clientStampedAt` applies unconditionally (online direct-call path).
- `mutationId` dedup returns the cached "no-op" response on retry of a stale mutation.

### 7.4 Reconcile preserves pending

- Seed IDB with a pending uncheck in `mutationQueue`. Call `reconcileFromServer(items)` where the server says the item is `checked`. Expect the merged IDB row to reflect the *queued uncheck*, not the server state.

### 7.5 Manual / browser

- Flight mode. Open `/einkauf` (cached shell). Items render from IDB. Chip is `"Prüfe Verbindung…"` for ≤5 s, then flips to `"Offline"`. List is unchanged.
- Flight mode. Toggle three items. Queue grows to 3. Disable flight mode. Chip flips through `"checking" → "online"`. Queue drains; chip shows `"Synchronisiere 3…"` then green. Items match server state.
- Two devices: A goes offline, checks item 7 at T1. B (online) unchecks item 7 at T2 > T1. A returns online and replays; server rejects A's stale mutation; A's UI updates to `checked: false`.

## 8. Open questions

None blocking. Two minor items the implementer may tighten:

- The `X-Nomly-Shell` precache header approach in §4.3 assumes the SW issues the precache fetch with that header. If for some reason the precache cannot set the header, an alternative is to render the page server-side with `initialItems={[]}` whenever the request is a navigation that the SW intercepts — detectable via the `Sec-Fetch-Dest: document` + `Sec-Fetch-Mode: navigate` combination plus an explicit `?shell=1` query param appended by the SW. Either works; the header is cleaner.
- If the brief `"checking"` chip flicker on initial paint feels too noisy in practice, the chip can be hidden entirely (`null` from `chipPresentation`) during `"checking"`, reappearing only once the state resolves. Decide during the implementation PR based on feel.
