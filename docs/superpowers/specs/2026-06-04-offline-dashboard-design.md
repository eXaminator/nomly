# Offline-first dashboard, Start nav entry, configurable start page

Date: 2026-06-04
Status: Approved

## Goal

Make the dashboard (`/`) usable offline like the shopping list, add it to the
mobile bottom navigation, make it the PWA entry page (user-configurable), and
expose it as a PWA long-press shortcut.

## Decisions (user-confirmed)

1. **Offline data model: snapshot + live shopping overlay.** The dashboard
   stays fully server-rendered. Offline serves the last cached page; the
   shopping summary card hydrates live from the existing shopping IndexedDB.
2. **Freshness model: stale-while-revalidate.** Show cached data instantly,
   always fire the request when online, update cache *and* displayed data
   when it lands.
3. **Link disabling: dashboard cards only.** Recipe/plan links inside
   dashboard cards are disabled while offline; shopping links keep working.
   Top/bottom nav is untouched.
4. **Bottom nav:** new first entry `/` with lucide `House` icon, label
   „Start“. Desktop top nav gets the same entry for consistency.
5. **Start page: configurable per device.** `start_url` → `/start`, a tiny
   client redirect page reading a `localStorage` preference set in
   Einstellungen. Default `/`.
6. **PWA shortcut:** „Start“ (`/`) as first entry in `manifest.ts` shortcuts.
7. **No past meals — ever**, including when rendering from cache.

## Architecture

### Service worker (`public/sw.js`)

- Navigations to `/`: **stale-while-revalidate.**
  - Cache hit → respond from cache immediately; `event.waitUntil` a
    background fetch that overwrites the cache **only** when
    `response.ok && response.type === "basic"`. 500/401/redirects never
    clobber a good snapshot; fetch errors are swallowed.
  - No cache → network, then cache (same `ok` guard).
  - Best-effort seed of the `/` cache at SW install (errors swallowed).
- Pre-cache the `/start` shell at install so app launch works offline.
- Error hardening: all new handler logic wrapped so any internal SW error
  falls through to plain `fetch(request)`; `cache.put` is fire-and-forget
  with swallowed errors. SW version bump; existing activate-time cleanup
  removes old caches.

### Client refresh (`DashboardRefresher`)

Small client component rendered by the dashboard page:

- On mount, when online: `router.refresh()` → re-fetches the RSC payload and
  swaps fresh data into the rendered server components in place.
- Re-fires when connectivity transitions offline → online (via the existing
  `useConnectivity()` hook).
- Never runs while offline; refresh failures are swallowed (snapshot stays).

Verify the page renders dynamically and the Next client router cache does
not serve stale RSC payloads for nav taps (Next 15+ dynamic `staleTimes`
default 0); force `dynamic = "force-dynamic"` if the build output says
otherwise.

### Live shopping overlay

- The shopping summary card receives server values as initial props; a
  client child reads `items` / `supermarkets` / `categories` from the
  existing IndexedDB (`src/lib/shopping/offline/db.ts`) on mount and
  recomputes open-item count + per-store needed counts (client port of
  `countNeededItemsPerSupermarket`). Once hydrated, IDB wins — same
  "IDB is authoritative on the client" rule as `/einkauf`.
- All IDB reads in try/catch → on any failure keep the server snapshot.
- `TodayShoppingWarning` and the meals/recipes cards stay pure snapshot
  (today-status needs server-side meal↔item joins; accepted limitation).

### No past meals

- `UpcomingMealsCard`: client-side hydrate-then-filter (`useEffect`) drops
  days before the device's "today" at view time. No-op online (server sends
  today+); from a stale snapshot only remaining valid days show. Effect-based
  to avoid hydration mismatch with cached HTML; worst case a sub-frame flash
  of the unfiltered list, only when serving from cache.

### Offline link disabling

- New client component `OfflineAwareLink` (uses `useConnectivity()`):
  online → normal `<Link>`; `offline`/`sessionExpired` → same content as a
  non-interactive, dimmed element with `aria-disabled`.
- Used for `/plan` and `/rezepte/...` links in `UpcomingMealsCard`,
  `TopRecipesCard`, `NeedsUpdateCard`. `/einkauf` links stay plain links.

### Navigation

- `nav-items.tsx`: prepend `{ href: "/", label: "Start", icon: House }`.
- Bottom nav grid 4 → 5 columns. Active-state match must be exact for `/`.
- Same entry in the desktop top nav.

### Start page

- `manifest.ts`: `start_url: "/start"`; shortcuts get „Start“ (`/`) first.
- `/start`: static client page, pre-cached by SW. Reads
  `localStorage["nomly.startPage"]` (try/catch), validates against allowlist
  (`/`, `/einkauf`, `/plan`, `/rezepte`), falls back to `/`, then
  `router.replace()`.
- Einstellungen: „Startseite“ select writing that localStorage key —
  deliberately per-device, no DB migration, works offline.
- Note: `start_url`/shortcuts are baked at install; takes effect after a
  one-time PWA reinstall.

## Testing

- Unit: client-side count computation (IDB overlay), `OfflineAwareLink`
  (online vs offline rendering), past-meals filter, `/start` allowlist
  fallback.
- Manual: build; load dashboard online; DevTools offline; reload → snapshot
  renders instantly, shopping card reflects IDB, recipe/plan links dimmed,
  Einkauf links work; back online → data refreshes in place; `/start`
  honors the setting.
- `npm run build` before pushing (RSC client/server boundary errors are only
  caught there).
