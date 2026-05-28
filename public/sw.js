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
