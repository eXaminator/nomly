// nomly service worker — local-first offline shell.
// - Pre-caches a data-less /einkauf shell at install time via the
//   X-Nomly-Shell header. The cached shell never contains live items, so
//   navigating to /einkauf while offline can no longer clobber IDB.
// - Caches static assets + supermarket/category data only. The shopping
//   list itself is owned by IndexedDB on the client.

const CACHE_VERSION = "v4";
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

    // Best-effort seed of the dashboard snapshot so even a first launch
    // offline has something to show. `redirect: "error"` keeps a login
    // redirect from being cached when the session is dead at install time;
    // normal visits keep the snapshot fresh via stale-while-revalidate.
    try {
      const dashRes = await fetch("/", { cache: "no-store", redirect: "error" });
      if (dashRes.ok) await cache.put("/", dashRes.clone());
    } catch (e) {
      console.warn("[sw] dashboard pre-cache failed", e);
    }

    // Pre-cache static asset list from the build manifest.
    try {
      const res = await fetch("/sw-precache.json", { cache: "no-store" });
      if (res.ok) {
        const { shell = [], assets = [] } = await res.json();
        // Skip /einkauf — we already cached the data-less version above
        // with the X-Nomly-Shell header. A second fetch without that
        // header would replace it with a data-full page that re-introduces
        // the stale-snapshot bug.
        const items = [...shell, ...assets].filter(
          (p) => Boolean(p) && p !== "/einkauf",
        );
        await cache.addAll(items);
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
function isDashboardNavigation(req, url) {
  return req.mode === "navigate" && url.pathname === "/";
}
// Recipe photos render on the dashboard and in lists; cache-first keeps them
// visible offline (bounded: one household's recipe images).
function isRecipePhoto(req, url) {
  return req.destination === "image" && url.pathname.startsWith("/api/v1/");
}
function isNavigation(req) {
  return req.mode === "navigate";
}
// A response that says "you are signed out": either the proxy's re-auth 401 or
// the opaque redirect a navigation gets when the proxy sends it to the IdP.
// A response that means the server — or the reverse proxy in front of it — is
// broken. Treated exactly like a thrown fetch: the cached shell beats the
// gateway's 503 page, which would otherwise leave the user with nothing at all
// on a hard reload while the container is down.
function isServerFailure(res) {
  return res.status >= 500;
}
function isSessionGone(res) {
  return res.type === "opaqueredirect"
    || res.redirected
    || (res.status === 401 && res.headers.get("x-nomly-reauth") !== null);
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
  if (isDashboardNavigation(req, url)) {
    event.respondWith(dashboardNavigationStrategy(event));
    return;
  }
  if (isNavigation(req)) {
    event.respondWith(navigationFallbackStrategy(req));
    return;
  }
  if (isRecipePhoto(req, url)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
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
  let failure = null;
  try {
    const res = await fetch(req);
    if (!isServerFailure(res)) return res;
    failure = res;
  } catch {
    // unreachable — fall through to the cache
  }
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match("/einkauf");
  if (cached) return cached;
  const offline = await cache.match("/offline");
  if (offline) return offline;
  if (failure) return failure;
  return new Response(
    "<!doctype html><meta charset=utf-8><title>nomly offline</title><p>Offline — Einkaufsliste konnte nicht geladen werden. Öffne die Seite einmal online, dann steht sie auch offline bereit.</p>",
    { headers: { "content-type": "text/html;charset=utf-8" }, status: 503 },
  );
}

async function dashboardNavigationStrategy(event) {
  // Stale-while-revalidate for the dashboard: respond from cache instantly,
  // refresh the cache in the background. The page itself re-fetches fresh
  // data via router.refresh() when online, so what the user *sees* never
  // stays stale — this cache only decides what paints first (and what shows
  // offline). Unlike /einkauf, caching the data-bearing page is safe: the
  // dashboard is read-only, nothing can clobber IDB.
  const req = event.request;
  try {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match("/");

    const revalidate = (async () => {
      try {
        const res = await fetch(req);
        // The session is gone: drop the snapshot. Serving it again would hide
        // the server's login redirect behind a cached page that immediately
        // re-fetches, 401s and reloads — the expired-session loop. Without a
        // snapshot the next navigation reaches the network and lands on the
        // IdP. (`opaqueredirect` is what the login 307 looks like from here,
        // because a navigation request carries redirect: "manual".)
        if (isSessionGone(res)) {
          await cache.delete("/");
          return res;
        }
        // Only a good same-origin 200 may overwrite the snapshot — a 500 or
        // a login redirect must never eat a working offline dashboard.
        if (res.ok && res.type === "basic" && !res.redirected) {
          try {
            await cache.put("/", res.clone());
          } catch (e) {
            console.warn("[sw] dashboard cache update failed", e);
          }
        }
        return res;
      } catch {
        return null; // offline — caller falls back
      }
    })();

    if (cached) {
      event.waitUntil(revalidate);
      return cached;
    }
    const res = await revalidate;
    if (res && !isServerFailure(res)) return res;
    const offline = await cache.match("/offline");
    if (offline) return offline;
    if (res) return res;
    return new Response(
      "<!doctype html><meta charset=utf-8><title>nomly offline</title><p>Offline — das Dashboard konnte nicht geladen werden. Öffne die Seite einmal online, dann steht sie auch offline bereit.</p>",
      { headers: { "content-type": "text/html;charset=utf-8" }, status: 503 },
    );
  } catch (e) {
    // Any unexpected SW bug must never take the app down — go to network.
    console.warn("[sw] dashboard strategy failed, falling through", e);
    return fetch(req);
  }
}

async function navigationFallbackStrategy(req) {
  const cache = await caches.open(SHELL_CACHE);
  let failure = null;
  try {
    const res = await fetch(req);
    if (!isServerFailure(res)) return res;
    failure = res;
  } catch {
    // unreachable — fall through to the cache
  }
  // Serve the page itself when it was precached (e.g. /start), else the
  // generic offline fallback.
  const cached = await cache.match(new URL(req.url).pathname);
  if (cached) return cached;
  const offline = await cache.match("/offline");
  if (offline) return offline;
  if (failure) return failure;
  return new Response(
    "<!doctype html><meta charset=utf-8><title>nomly offline</title><p>Offline.</p>",
    { headers: { "content-type": "text/html;charset=utf-8" }, status: 503 },
  );
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
