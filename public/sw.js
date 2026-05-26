/* eslint-disable */
// nomly service worker — Epic 8.
// Caches the /einkauf shell + static chunks (cache-first) and the shopping
// + supermarket + category GET endpoints (network-first with cache fallback).
// Never intercepts non-GET — the offline mutation queue lives client-side.

const CACHE_VERSION = "v1";
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isShellNavigation(req, url)) {
    event.respondWith(shellNavigationStrategy(req));
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
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match("/einkauf");
  // Kick the refresh in the background so the cache stays current.
  fetch(req).then((res) => {
    if (res.ok) cache.put("/einkauf", res.clone());
  }).catch(() => undefined);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put("/einkauf", fresh.clone());
    return fresh;
  } catch {
    return new Response(
      "<!doctype html><meta charset=utf-8><title>nomly offline</title><p>Offline — Einkaufsliste konnte nicht geladen werden. Öffne die Seite einmal online, dann steht sie auch offline bereit.</p>",
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
