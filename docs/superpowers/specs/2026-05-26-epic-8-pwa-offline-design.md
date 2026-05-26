# Epic 8 — Offline shopping list (PWA)

- **Date:** 2026-05-26
- **Status:** Design approved (mascot artwork pending)
- **Owner:** Steven Weingärtner
- **Supersedes / refines:** §5.4 and §5.5 of `docs/superpowers/specs/2026-05-17-nomly-design.md` and the Epic 8 row in §7 of the same document.

## 1. Purpose

Turn `/einkauf` into a Progressive Web App that:

1. Installs to the home screen on iOS and Android with a real app icon, launches in standalone mode, and reaches the shopping list within one tap of opening the device.
2. Continues to work when the device is offline inside a supermarket — at minimum: view the list, check / uncheck items, switch the supermarket filter.
3. Surfaces a few key in-app pages as long-press shortcuts on the installed app icon, and is reachable from external apps (Home Assistant) via plain HTTPS URLs that open in the PWA when installed.
4. Identifies as nomly through a custom mascot icon — a friendly round creature in the brand orange.

This epic ships a fully usable offline shopping experience over plain HTTP. Realtime peer sync over WebSockets remains Epic 9; this design is built so swapping transports there is a one-file change.

## 2. Scope

### 2.1 In scope

- Web manifest (`src/app/manifest.ts`) emitting `/manifest.webmanifest` with name, theme color, icons, shortcuts, scope, `start_url`.
- Mascot icon family: hand-authored SVG plus PNG renders at the manifest's required sizes, including a maskable variant.
- Hand-rolled service worker at `public/sw.js`, registered from a client component.
- IndexedDB-backed offline store for the shopping list page, using the `idb` micro-library.
- Optimistic check / uncheck mutations with a FIFO replay queue.
- Offline-aware supermarket filter (the filter and the underlying supermarket + category metadata are cached locally).
- Online / offline indicator on `/einkauf` showing connection state and pending-mutation count.
- Plain HTTPS deep linking from external apps into any in-scope page.

### 2.2 Out of scope (deferred)

- Offline add / edit qty / edit note / delete for shopping items. Online-only — UI disables these controls when offline.
- Offline access to recipes, planner, settings, and any other route. They attempt network and show a generic offline state on failure.
- WebSocket realtime sync. Mutation transport in this epic is HTTP `PATCH`; Epic 9 swaps to a WS `mutate` frame on the same protocol shape and adds peer broadcast.
- Web Share Target API.
- Background Sync API (unsupported on iOS, and our connectivity model triggers on page focus / network events instead).
- Offline photo cache.

## 3. Top-level decisions

| Topic | Decision |
|---|---|
| Domain | Configurable via existing `BASE_URL` env var. No hardcoded host anywhere — manifest, icon URLs, OG tags all derive from it. Production target is `https://nomly.weingaertner.pro`. |
| Offline scope | `/einkauf` only. Read + toggle check + switch supermarket filter. All other in-app pages remain online-first. |
| Mutation surface offline | Check / uncheck only. Add / edit / delete remain online-only and the UI controls visibly disable when offline. |
| Service worker | Hand-rolled `public/sw.js`. No Workbox. Versioned cache keys; clean-up on `activate`. |
| IndexedDB | `idb` micro-library (~1.5 kB gzip) for promise-based access. Single database `nomly`, version 1. |
| Manifest source | Next.js's `src/app/manifest.ts` convention — emits `/manifest.webmanifest` at request time so absolute URLs follow `BASE_URL`. |
| Shortcuts | Manifest `shortcuts` array (long-press menu on Android) for Einkauf, Plan, Rezepte, Neues Rezept. Each in-scope page can additionally be added to the home screen via the browser as its own icon and will launch in standalone PWA mode. |
| Deep links | Plain HTTPS URLs. No custom URL scheme, no Web Share Target. Reliable opening into the installed PWA depends on the OS — Android via WebAPK intent filters does this automatically when `scope = "/"`; iOS opens Safari unless the user saved that specific URL to the home screen. Accepted limit. |
| Sync transport | HTTP `PATCH /api/v1/shopping/items/:id` for individual toggles; `GET /api/v1/shopping` for full re-fetch on reconnect / focus. Bundled idempotency via `mutationId`. |
| Conflict resolution | Last-write-wins on toggle. Both `check` and `uncheck` mutations unconditionally apply; the version returned by the server overwrites the local row. |

## 4. Web manifest

### 4.1 Shape

`src/app/manifest.ts` returns the following (URLs absolute, derived from `BASE_URL`):

```ts
{
  name: "nomly",
  short_name: "nomly",
  description: "Kochbuch, Wochenplan, Einkaufsliste",
  start_url: "/einkauf",
  scope: "/",
  display: "standalone",
  display_override: ["standalone", "minimal-ui"],
  background_color: "#13110f",   // matches --color-bg in dark theme
  theme_color: "#ed7826",        // matches --color-accent (HSL 28 78% 50%)
  lang: "de",
  dir: "ltr",
  orientation: "portrait",
  icons: [
    { src: "/icons/icon-192.png",          sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-384.png",          sizes: "384x384", type: "image/png" },
    { src: "/icons/icon-512.png",          sizes: "512x512", type: "image/png" },
    { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: "/icons/icon.svg",              sizes: "any",     type: "image/svg+xml" },
  ],
  shortcuts: [
    { name: "Einkauf",      short_name: "Einkauf", url: "/einkauf",     icons: [{ src: "/icons/shortcut-einkauf-96.png", sizes: "96x96", type: "image/png" }] },
    { name: "Planer",       short_name: "Planer",  url: "/plan",        icons: [{ src: "/icons/shortcut-plan-96.png",     sizes: "96x96", type: "image/png" }] },
    { name: "Rezepte",      short_name: "Rezepte", url: "/rezepte",     icons: [{ src: "/icons/shortcut-rezepte-96.png",  sizes: "96x96", type: "image/png" }] },
    { name: "Neues Rezept", short_name: "Neu",     url: "/rezepte/neu", icons: [{ src: "/icons/shortcut-neu-96.png",      sizes: "96x96", type: "image/png" }] },
  ],
}
```

`start_url = /einkauf` because the dominant use case is opening the app to shop. Power users who add per-URL shortcuts get their preferred entry point through that path. `scope = /` means any in-scope deep link (HA → `https://…/rezepte/42`) launches in standalone mode on Android.

### 4.2 Theme colors

`src/app/layout.tsx` already renders a `<meta name="theme-color">`. Replace any existing entry with two media-conditional tags so the OS browser chrome matches the active theme:

```html
<meta name="theme-color" content="#ed7826" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#ed7826" media="(prefers-color-scheme: dark)"  />
```

Same brand orange in both — keeps the address-bar tint consistent regardless of system theme.

### 4.3 Manifest delivery

The existing auth proxy already bypasses `/manifest.webmanifest` (`src/proxy.ts:7`). No middleware change needed.

## 5. Icon family

### 5.1 Mascot brief

The icon is a hand-authored mascot — a round, friendly creature in the brand orange (`#E1721F`, the RGB form of the brand HSL `28 78% 50%`). Direction was locked during the brainstorming session on 2026-05-26: the "content eater" variant — arched ^_^ eyes, soft cheek blush, contented closed-mouth smile, ground shadow tucked behind the body. Original artwork inspired by the *Cut the Rope* "Om Nom" silhouette but not a copy.

Locked constraints:

- Two arched ^_^ eyes (curved strokes, no pupils), small cream cheek blush, single curved smile. No nose, no extra features.
- Body fills roughly 88 % of the icon canvas, centered both axes. Shadow is a small, low-opacity ellipse beneath the feet, **drawn first** so the body silhouette overlaps it.
- Silhouette must read at 32 × 32 px (the ^_^ eyes + smile collapse to three confident strokes at that size).
- Non-maskable variants sit on a soft cream background (`#FFF8EF`) with the body slightly inset from the canvas edges.
- The maskable variant paints the brand orange edge-to-edge; face features are traced in cream (`#FFF8EF`) so they remain legible against the orange-on-orange ground. The mascot is inset so it fits inside the Android adaptive-icon safe area (inner 80 % of the canvas).
- Single source of truth: `public/icons/icon.svg` (non-maskable) and `public/icons/icon-maskable.svg` (maskable). PNG variants are rendered from these SVGs by a build-time script — never hand-rasterized.

**Reference sketches** committed alongside this spec for the implementer to start from:

- `docs/superpowers/specs/2026-05-26-epic-8-assets/mascot-reference.svg`
- `docs/superpowers/specs/2026-05-26-epic-8-assets/mascot-maskable-reference.svg`

These reference SVGs are starting points, not the shipped assets. Final production artwork is iterated and polished during the implementation PR — line weights, shadow softness, optional micro-details — but the personality direction is fixed.

### 5.2 Pipeline

`scripts/render-icons.mts` (committed, runs on demand — not part of `npm run build`):

- Reads `public/icons/icon.svg` and `public/icons/icon-maskable.svg`.
- Uses `sharp` (already a dep) to render PNGs at 192, 384, 512, plus the maskable 512.
- Renders four shortcut icons at 96 × 96 from `public/icons/shortcut-<key>.svg` templates that compose the mascot with a small badge ("E", "P", "R", "+").
- Writes all PNGs to `public/icons/`.
- Idempotent. Re-running with unchanged sources is a no-op for git.

The script is invoked manually whenever the mascot or a shortcut SVG changes. PNG outputs are committed to git so production builds never need `sharp` for icon work.

### 5.3 favicon

Replace `src/app/favicon.ico` with `src/app/icon.svg` (Next.js convention — auto-generates the appropriate `<link rel="icon">` tags) and a 32 × 32 ICO fallback for legacy browsers, both rendered from the same mascot source.

## 6. Service worker

### 6.1 Registration

A small client component `src/components/pwa/register-sw.tsx`:

```tsx
"use client";
import { useEffect } from "react";

export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => console.warn("SW registration failed", err));
  }, []);
  return null;
}
```

Mounted once in `src/app/layout.tsx`. Dev mode skips registration because Next.js dev builds change asset hashes constantly — caching them would be hostile.

### 6.2 Lifecycle and caches

`public/sw.js` carries a `CACHE_VERSION` constant. Three named caches per version:

| Cache name | Contents | Strategy |
|---|---|---|
| `nomly-shell-v<n>` | `/einkauf` HTML, the offline fallback HTML, manifest, mascot SVG, the small set of Next.js JS/CSS chunks the shopping page needs (discovered at install time from a tiny `/sw-precache.json` generated by the build) | Cache-first, network in background to refresh. |
| `nomly-data-v<n>` | Last successful response to `GET /api/v1/shopping`, `GET /api/v1/supermarkets`, `GET /api/v1/categories` | Network-first; on network failure, serve cached response. |
| `nomly-static-v<n>` | `/_next/static/*`, `/icons/*` | Cache-first. Asset hashes change per build, so stale entries are naturally retired when nothing references them; `activate` also drops any cache whose version doesn't match `CACHE_VERSION`. |

`fetch` handler routing:

```
if (req.method !== "GET")                  → fetch(req)           // pass-through
if (req.url is navigation && path === "/einkauf")
                                           → cache-first, refresh-in-bg from shell
if (req.url path startsWith "/api/v1/shopping" or "/api/v1/supermarkets" or "/api/v1/categories")
                                           → network-first; fallback to data cache
if (req.url path startsWith "/_next/static/" or "/icons/")
                                           → cache-first from static
otherwise                                  → fetch(req)
```

The SW deliberately does **not** intercept `POST` / `PATCH` / `DELETE`. Mutations always go straight to the network; the IDB queue handles retry. This keeps the SW small and avoids the trap of double-queuing.

### 6.3 Precache manifest

A small build step writes `/sw-precache.json` listing the static assets the shell needs. Implementation options:

- A short Node script that runs after `next build`, inspects `.next/app-build-manifest.json`, picks the entries for the `/einkauf` route, and emits a JSON list of `/_next/static/...` URLs into `public/sw-precache.json`.
- That script (`scripts/generate-precache.mts`) is wired into `package.json` `build` as a post-step: `"build": "next build && node ... scripts/generate-precache.mts"`.

The service worker `fetch`es `/sw-precache.json` on install and `cache.addAll()` its contents into `nomly-shell-v<n>`.

If the script fails or the file is missing, the SW falls back to caching just the navigation HTML and the `/_next/static` assets opportunistically on first use. The offline-first experience degrades to "needs one online visit to /einkauf before going offline" — which is still acceptable for the personal use case.

### 6.4 Updates

Standard `skipWaiting` + `clients.claim` flow:

- On install: `self.skipWaiting()` only after `cache.addAll` succeeds.
- On activate: clean up caches that don't match the current `CACHE_VERSION`. Call `clients.claim()`.
- The page listens for `controllerchange` and shows a toast: "Update verfügbar — Neu laden". Tapping reloads.

## 7. IndexedDB

### 7.1 Schema

Database name `nomly`, version 1.

| Object store | Key path | Contents |
|---|---|---|
| `items` | `id` (number) | Full `ShoppingItem` row mirrored from the server: `id`, `name`, `type` (`ingredient`/`product`), `categoryId`, `quantity`, `unit`, `note`, `checked`, `checkedAt`, `version`, `sources` (array of `{ mealPlanId, mealDate, recipeId, recipeTitle, contributedQuantity, contributedUnit }`), `unavailableSupermarketIds` (number array). Index `byChecked` on `checked` for the rendering split. |
| `supermarkets` | `id` | `{ id, name, categories: [{ categoryId, sortOrder }] }`. Used to drive offline filter switching. |
| `categories` | `id` | `{ id, name }`. Used for grouping headers when no filter is active. |
| `mutationQueue` | `mutationId` (uuid) | `{ mutationId, itemId, type: "check" \| "uncheck", queuedAt: ISOString, attempts: number, lastError?: string }`. Index `byQueuedAt` for FIFO drain order. |
| `meta` | `key` | Singleton rows keyed by name: `{ key: "shoppingFetchedAt", value: ISOString }`, `{ key: "supermarketsFetchedAt", value: ISOString }`, `{ key: "schemaVersion", value: 1 }`. |

`mutationId` is generated client-side as a UUID v4 the moment the user taps the checkbox.

### 7.2 Library

`idb` (^8.x) added as a production dependency. Access through a thin `src/lib/shopping/offline/db.ts` module that exports typed getters for each store and a `transaction(stores, mode)` helper. No raw IndexedDB calls outside this file.

### 7.3 Hydration and refresh

On `/einkauf` first paint:

1. The server-rendered page still issues the SSR `listShoppingItems()` call (current behaviour preserved).
2. A `useEffect` on the client reads the IDB `items` store and compares to the SSR-rendered state. If IDB has newer entries (different `version`) the client overlays them — keeps the page coherent if mutations were queued from a previous session that hasn't replayed yet.
3. A `GET /api/v1/shopping` is issued; on success, IDB `items` is fully replaced and `meta.shoppingFetchedAt` updated.
4. `GET /api/v1/supermarkets` is issued (only if `meta.supermarketsFetchedAt` is older than 24 h or absent) to refresh the filter data.

### 7.4 Optimistic mutations

Toggle handler in `src/components/shopping/shopping-list-view.tsx`:

```
const mutationId = crypto.randomUUID();
const next = { ...item, checked: !item.checked, checkedAt: !item.checked ? now : null };

await tx(["items", "mutationQueue"], "readwrite", async (tx) => {
  await tx.items.put(next);
  await tx.mutationQueue.put({
    mutationId,
    itemId: item.id,
    type: next.checked ? "check" : "uncheck",
    queuedAt: nowIso,
    attempts: 0,
  });
});

uiStore.applyItem(next);  // optimistic UI

// fire-and-forget; sync engine picks it up
syncEngine.kick();
```

UI never awaits the network. The sync engine (next section) handles transmission.

## 8. Sync engine

`src/lib/shopping/offline/sync.ts` owns network mutation flow and online detection.

### 8.1 Connectivity model

Single source of truth: a `connectivity` store with values `"online"` | `"offline"` | `"syncing"`.

Signals that update it:

- `window` events `online` / `offline` flip the value.
- A `HEAD /api/health` heartbeat every 30 s while the page is visible. A heartbeat failure flips to `offline`; success flips to `online`. The heartbeat uses `AbortSignal.timeout(5000)`.
- Any successful API call flips to `online`. Any failed call (network error, not HTTP error) flips to `offline`.
- `document.visibilitychange` triggers an immediate heartbeat on becoming visible.

`navigator.onLine` is consulted but not trusted — it's used only to short-circuit "definitely offline" cases (skip a heartbeat that would obviously fail).

### 8.2 Queue drain

`syncEngine.kick()` is idempotent and reentrant-safe (a `draining` flag plus a deferred `again` flag).

```
async function drain() {
  if (draining) { again = true; return; }
  draining = true;
  try {
    while (true) {
      const entry = await db.mutationQueue.firstByIndex("byQueuedAt");
      if (!entry) break;
      try {
        const updated = await patchItem(entry.itemId, entry.type, entry.mutationId);
        await db.transaction(["items", "mutationQueue"], "readwrite", async (tx) => {
          await tx.items.put(updated);
          await tx.mutationQueue.delete(entry.mutationId);
        });
        uiStore.applyItem(updated);
      } catch (err) {
        await db.mutationQueue.put({ ...entry, attempts: entry.attempts + 1, lastError: String(err) });
        if (isAuthFailure(err)) { uiStore.setSessionExpired(); break; }
        // network / 5xx — back off and abort this drain pass
        await sleep(backoff(entry.attempts));
        break;
      }
    }
  } finally {
    draining = false;
    if (again) { again = false; void drain(); }
  }

  // After the queue drains, refresh the full list once so peer changes land.
  if (queueIsEmpty()) { await refreshList(); }
}
```

Backoff: `min(30 s, 500 ms * 2^attempts)` with full jitter. After 10 attempts on the same entry, surface a non-blocking error chip but keep the entry queued — the user can tap "Erneut versuchen" in the offline drawer.

### 8.3 Server-side dedup

`PATCH /api/v1/shopping/items/:id` accepts `{ checked, mutationId }` and replies with the updated item. A small in-process LRU keyed by `mutationId` (capacity 256, TTL 10 minutes) returns the previously computed response when the same `mutationId` is replayed. This handles the "we sent the request, the response was lost, we retried" case.

The existing endpoint signature already accepts `checked` per the parent spec (§4.6); only the optional `mutationId` field and the dedup cache are new. Server-side schema (Drizzle) is unchanged.

### 8.4 Conflict resolution

LWW per item field. Both `check` and `uncheck` mutations unconditionally apply server-side — no version guard for the toggle path. The server response carries the new `version` (incremented on each mutation) so the client always overwrites its local row with the authoritative state.

Quantity / unit / note edits remain online-only and reuse the existing endpoint behaviour unchanged.

## 9. Offline UX

### 9.1 Indicator

A chip lives at the top of the `/einkauf` page header, replacing nothing — it sits between the page title and the supermarket filter on desktop, and on the right edge of the header row on mobile:

- `online`, queue empty: green dot + "Online". Static.
- `online`, queue non-empty: amber dot + "Synchronisiere `n` …". Replaces with the green chip once the queue drains.
- `offline`: muted dot + WiFi-slash icon + "Offline". If `n > 0`, suffix " — `n` ausstehend".
- `sessionExpired`: red dot + "Anmeldung abgelaufen". Tap → navigates to `/api/auth/login?next=/einkauf`.

Tapping the chip in any state opens a small drawer (`vaul` on mobile, popover on desktop) listing pending mutations:

- Item name + intended state ("Mehl — abgehakt" / "Mehl — wiederhergestellt").
- Timestamp.
- "Erneut versuchen" button per row, plus a global "Jetzt synchronisieren".

### 9.2 Disabled controls when offline

The `connectivity` store gates the following controls:

| Control | Behaviour offline |
|---|---|
| Row checkbox / row click toggle | **Enabled** — optimistic + queued. |
| Supermarket filter dropdown | **Enabled** — data is cached. |
| "Mahlzeiten hinzufügen" button | Visually disabled (reduced opacity + `aria-disabled`), tap shows toast "Nur im Online-Modus verfügbar." |
| "Artikel hinzufügen" button | Same as above. |
| Row "Bearbeiten" (qty/unit/note) | Same as above. |
| Row delete | Same as above. |
| "Liste leeren" | Same as above. |
| "Hier (nicht) verfügbar" toggle | Same as above. |

A small `useConnectivity()` hook reads the store; components either receive a `disabled` prop or check the hook directly. No global modal.

### 9.3 Visual polish

- The mascot icon appears on the splash screen (handled by the manifest's `background_color` + icon).
- A `<link rel="apple-touch-icon">` in `layout.tsx` pointing at the 180 × 180 PNG rendition of the mascot (rendered by the same icon pipeline; added to the size list in `scripts/render-icons.mts`).
- `apple-mobile-web-app-capable` and `apple-mobile-web-app-status-bar-style` meta tags so iOS Safari "Add to Home Screen" launches in standalone mode with a dark status bar.

## 10. Deep linking

Plain HTTPS — no custom scheme.

- Any `https://<BASE_URL>/...` URL that falls within `scope = "/"` opens in the installed PWA on Android. Tested in the manual checklist below.
- On iOS, only URLs the user explicitly saved to the home screen launch in standalone mode; everything else opens in Safari. Accepted.
- Home Assistant integration: dashboards link to `https://nomly.weingaertner.pro/einkauf`, `/plan`, `/rezepte/<id>`, etc. No nomly-side code changes needed for this beyond the manifest's `scope`.
- The existing OIDC redirect flow (`/api/auth/login?next=<path>`) already round-trips arbitrary `next` values correctly, so deep links into protected pages bounce through auth on first hit if needed.

## 11. Auth interaction

- Service worker fetches carry the iron-session cookie automatically — the SW does not strip or rewrite headers.
- `/api/health` (used for the heartbeat) is already auth-bypassed (`src/proxy.ts`), so heartbeats keep working even if the session expires.
- Session expiry while offline: the queue stockpiles mutations. On reconnect, the first replayed mutation returns 401; the sync engine flips `connectivity` to `sessionExpired`, surfaces the banner, and stops draining until the user re-authenticates. Queue entries persist across `/api/auth/login` and resume on page reload after callback.
- OIDC login itself requires network — there is no offline auth path. Accepted.

## 12. Testing

### 12.1 Automated

- `tests/shopping/offline-store.test.ts` — Vitest unit tests for the offline store: hydrate from empty, hydrate from existing IDB, optimistic toggle writes to both stores, queue drain consumes entries FIFO, server dedup return value overwrites local row.
- `tests/shopping/offline-sync.test.ts` — Vitest unit tests for the sync engine: backoff progression, 401 surfaces `sessionExpired`, network error keeps queue intact, success removes entry and triggers list refresh.
- IDB layer tests use `fake-indexeddb` (added as dev dep).
- `tests/manifest.test.ts` — loads `src/app/manifest.ts`, asserts the required fields are present and that `start_url`, `scope`, icon URLs are well-formed.
- `tests/icons/render-icons.test.ts` — runs `scripts/render-icons.mts` against a fixture SVG into a temp dir and asserts all expected output files exist at the right dimensions.

### 12.2 Playwright

A new `tests/e2e/shopping-offline.spec.ts`:

1. Sign in, load `/einkauf` online, check an item, verify server-side state via `GET /api/v1/shopping`.
2. `context.setOffline(true)`. Toggle two items. Assert the connectivity chip shows "Offline — 2 ausstehend" and that the IDB `mutationQueue` store contains two entries (read via `page.evaluate`).
3. `context.setOffline(false)`. Wait for the chip to show "Online" and for the queue to be empty. Verify server state matches.
4. With items checked locally, `context.setOffline(true)`, reload the page, assert the list renders from cache, assert `/einkauf` HTML was served from SW cache.

### 12.3 Manual verification checklist

In `docs/superpowers/specs/2026-05-26-epic-8-pwa-offline-design.md` itself, ship the following checklist for the implementer to walk through before declaring the epic done:

- [ ] Install to iOS home screen → mascot icon visible. Open offline → list visible. Toggle two items. Go online → mutations sync.
- [ ] Install to Android (Chrome) home screen → mascot icon visible. Long-press app icon → all four shortcuts present and functional.
- [ ] Add `/plan` to iOS home screen as its own icon → launches in standalone mode.
- [ ] Home Assistant button linking to `/rezepte/<id>` opens the PWA on Android (Safari on iOS — accepted).
- [ ] Lighthouse PWA audit on `/einkauf` reports installability and no critical issues.
- [ ] Theme color is brand orange in both light and dark mode address bars on browsers that show one.

## 13. Migration / rollout

- No DB migrations. Server-side schema unchanged.
- One new endpoint behaviour: `PATCH /api/v1/shopping/items/:id` accepts and dedups by an optional `mutationId`. Existing callers (web UI without the offline path, Home Assistant) work unchanged because the field is optional.
- First deploy: existing users see the install prompt and the manifest. No data is migrated; the offline store hydrates lazily on first `/einkauf` visit.
- SW cache versioning lets future SW updates roll out cleanly via the `controllerchange` toast.

## 14. Non-goals and explicit deferrals

- **Realtime WS sync (Epic 9).** Epic 8 ships HTTP-only sync; Epic 9 will keep the same `PATCH` semantics and add a parallel WS path.
- **Whole-app offline.** Only `/einkauf` is offline-capable in this epic.
- **Add / edit / delete offline.** Locked to online-only; surface disable per §9.2.
- **Custom URL scheme.** Plain HTTPS only; rejected per §3.
- **Background Sync API.** Not used; iOS lacks support and our heartbeat model covers the gap.
- **Photo caching.** Recipe photos are not cached; offline access to recipe pages is not a goal of this epic.
- **iOS-specific PWA limitations.** Accepted as-is.

## 15. Open items deliberately left flexible

- **Mascot artwork.** Brief is locked in (round creature, brand orange, two eyes + mouth, original art). Final SVG is iterated in the implementation PR.
- **Heartbeat cadence.** 30 s baseline may be tuned after observed in-store behaviour.
- **`/sw-precache.json` generator details.** Method is locked (parse `app-build-manifest.json`); the exact set of chunk patterns is determined when the script is written against the real build output.

## 16. Implementation note — Next.js 16

The repo is on Next.js 16, which the project's `AGENTS.md` flags as carrying breaking changes from prior major versions. Before writing the manifest module and icon files, the implementer must consult `node_modules/next/dist/docs/` for the current canonical conventions covering:

- `src/app/manifest.ts` (or `manifest.json`) shape and the runtime/static toggle.
- `src/app/icon.{svg,png}` and `src/app/apple-icon.{...}` conventions vs. the legacy `public/favicon.ico` placement.
- Whether `<meta name="theme-color">` should be expressed through the `viewport` export in the App Router.

If any of these conventions differ from this spec, prefer the documented Next.js 16 form and update the spec accordingly.

## 17. Dependencies added

- `idb` (^8.x) — production. Promise-based IndexedDB.
- `fake-indexeddb` (^6.x) — dev only. Drives the IDB unit tests under Vitest.

No other runtime deps. Service worker, manifest module, sync engine, and offline UI all build on existing libraries.
