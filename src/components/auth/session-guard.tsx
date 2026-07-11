"use client";

import { setConnectivity } from "@/lib/shopping/offline/connectivity";

/**
 * Breaks the "expired session → endless reload" loop.
 *
 * When the OIDC session dies while the client still shows a (usually
 * service-worker-cached) page, client `fetch()`es keep hitting the server:
 * `router.refresh()` from the dashboard refresher, `<Link>` prefetches, API
 * calls. The proxy answers those unauthenticated requests with a same-origin
 * 401 carrying `x-nomly-reauth` (it deliberately does NOT redirect a fetch to
 * the cross-origin IdP — that would fail CORS and make Next hard-reload in a
 * loop, see src/proxy.ts).
 *
 * This guard wraps the global `fetch` so it can observe that header and, the
 * first time it appears while we're online, perform a single top-level
 * navigation to `/api/auth/login`. That full-page navigation follows the 302
 * chain to Authentik without CORS — the user re-authenticates and lands back
 * on the page they were on. We install the wrapper at module-eval time (during
 * hydration, before any effect fires a refresh) so the very first offending
 * fetch is already intercepted.
 */
const REAUTH_HEADER = "x-nomly-reauth";

let installed = false;
let redirecting = false;

function goToLogin(): void {
  if (redirecting) return;
  redirecting = true;
  // Keep any connectivity-aware UI honest during the brief unload window.
  setConnectivity("sessionExpired");
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/api/auth/login?next=${encodeURIComponent(next)}`);
}

function installFetchGuard(): void {
  if (installed) return;
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;

  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await original(...args);
    try {
      // Only act on a real server response that flagged re-auth. A dead
      // session while *offline* surfaces as a thrown fetch, never a 401 body,
      // so `navigator.onLine` here is just belt-and-suspenders against
      // bouncing to a login page we can't reach.
      if (navigator.onLine && res.headers.get(REAUTH_HEADER)) {
        goToLogin();
      }
    } catch {
      // The guard must never break a fetch — swallow anything and pass through.
    }
    return res;
  };
}

installFetchGuard();

export function SessionGuard(): null {
  return null;
}
