// nomly service worker — Epic 8.
// Caches the /einkauf shell + static chunks (cache-first) and the shopping
// + supermarket + category GET endpoints (network-first with cache fallback).
// Never intercepts non-GET — the offline mutation queue lives client-side.

const CACHE_VERSION = "v2";
const SHELL_CACHE  = `nomly-shell-${CACHE_VERSION}`;
const DATA_CACHE   = `nomly-data-${CACHE_VERSION}`;
const STATIC_CACHE = `nomly-static-${CACHE_VERSION}`;
const ALL_CACHES   = new Set([SHELL_CACHE, DATA_CACHE, STATIC_CACHE]);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const res = await fetch("/sw-precache.json", { cache: "no-store" });
      if (res.ok) {
        const { shell = [], assets = [] } = await res.json();
        const cache = await caches.open(SHELL_CACHE);
        await cache.addAll([...shell, ...assets].filter(Boolean));
      }
    } catch (e) {
      // Precache failure is non-fatal — the SW still installs; missing
      // assets just stream from the network until they're cached on demand.
      console.warn("[sw] precache failed", e);
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
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

const DATA_PATHS = ["/api/v1/shopping", "/api/v1/supermarkets", "/api/v1/categories"];
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
    // Any other page: try network, fall back to the cached `/offline` shell
    // so the header + nav stay reachable on every route while offline.
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
  // Everything else: pass through.
});

async function shellNavigationStrategy(req) {
  // Network-first: while online a reload always returns the freshest shell
  // (so a deploy is picked up on the next load / pull-to-refresh), updating
  // the cache as it goes. Offline falls back to the cached shell.
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put("/einkauf", fresh.clone());
    return fresh;
  } catch {
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
  // Network-first; on failure serve the cached `/offline` so the AppShell
  // chrome stays usable (the nav components re-derive their active state from
  // `usePathname()` on the client, so highlighting is still correct).
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(req);
    return fresh;
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
