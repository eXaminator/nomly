"use client";

import {
  reportServerError,
  setConnectivity,
} from "@/lib/shopping/offline/connectivity";

/**
 * Makes it structurally impossible for a bad server response to reload the page.
 *
 * Next's router turns a router fetch it cannot use into an MPA navigation — a
 * hard `location` assign of the *current* URL (see `fetch-server-response.js`:
 * `if (!isFlightResponse || !res.ok || !res.body) return doMpaNavigation(...)`).
 * With the service worker serving the shell from cache, that assign lands right
 * back on the cached page, which hydrates, fires its refresh, gets the same bad
 * response, and assigns again. That is the endless reload — and it needs nothing
 * more than a server answering 503.
 *
 * Two halves keep it from happening:
 *
 *  - `experimental.useOffline` (next.config.ts) handles a router fetch that
 *    *throws*: Next parks it and retries when connectivity returns, instead of
 *    falling back to the MPA assign.
 *  - This guard converts the responses Next would refuse into exactly that
 *    thrown error, so a server which answers badly takes the parked-and-retried
 *    path too. Nothing is left that can reach `doMpaNavigation`.
 *
 * It also keeps the original job of the session guard: a dead OIDC session gets
 * one top-level navigation to the IdP, never a reload.
 *
 * Only router traffic is touched. An ordinary `fetch()` from a component still
 * receives its real response or its real rejection, because the offline queue
 * and every call site's own error handling are built on seeing them.
 */
const REAUTH_HEADER = "x-nomly-reauth";
const RSC_CONTENT_TYPE = "text/x-component";

/** Marker so the guard's own throw stays distinguishable from a bug in it. */
class ServerUnavailableError extends Error {
  constructor(status: number) {
    super(`nomly: server answered ${status}, request parked for retry`);
    this.name = "ServerUnavailableError";
  }
}

let installed = false;
let redirecting = false;

function goToLogin(): void {
  if (redirecting) return;
  redirecting = true;
  // Keep any connectivity-aware UI honest during the brief unload window.
  setConnectivity("sessionExpired");
  const next = window.location.pathname + window.location.search;
  // A full-page navigation is the point: it follows the 302 chain to the
  // cross-origin IdP, which `router.push()` cannot do (and a fetch would die on
  // CORS). The rule's suggested alternatives do not apply here.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/api/auth/login?next=${encodeURIComponent(next)}`);
}

/**
 * Is this one of Next's own router requests? Those are the only ones whose
 * failure can trigger an MPA navigation. Next marks them with the RSC header,
 * and appends `_rsc` to prefetch URLs.
 */
export function isRouterRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
  origin = "http://localhost",
): boolean {
  try {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (headers.has("rsc") || headers.has("next-router-prefetch")) return true;
    if (headers.has("next-router-state-tree")) return true;
    if (headers.has("next-action")) return true; // Server Action
    const url = input instanceof Request ? input.url : String(input);
    return new URL(url, origin).searchParams.has("_rsc");
  } catch {
    return false;
  }
}

/**
 * A response the router cannot use *and* that says the server, or something in
 * front of it, is broken — a 5xx from the app, or the HTML error page a reverse
 * proxy serves while the container is down.
 *
 * Deliberately narrower than Next's own "not usable" test: a 404 that still
 * carries a real RSC payload is Next rendering not-found, and its MPA fallback
 * reaches a server that answers consistently, so it cannot loop. Swallowing it
 * would only break not-found pages.
 */
export function isServerFailure(res: Response): boolean {
  if (res.status >= 500) return true;
  const flight = (res.headers.get("content-type") ?? "").startsWith(
    RSC_CONTENT_TYPE,
  );
  return !res.ok && !flight;
}

function installFetchGuard(): void {
  if (installed) return;
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;

  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    let router = false;
    try {
      router = isRouterRequest(input, init, window.location.origin);
    } catch {
      // The guard must never break a fetch.
    }

    let res: Response;
    try {
      res = await original(...args);
    } catch (err) {
      // Genuinely unreachable. Next's offline module parks router requests and
      // retries them; every other caller sees its own rejection as before.
      if (router) setConnectivity("offline");
      throw err;
    }

    if (!router) return res;

    let failedWith: number | null = null;
    try {
      // A dead session while *offline* surfaces as a thrown fetch, never a 401
      // body, so `navigator.onLine` here is belt-and-suspenders against
      // bouncing to a login page we cannot reach.
      if (navigator.onLine && res.headers.get(REAUTH_HEADER)) {
        goToLogin();
        // Withhold the response. Handing this 401 back to the router makes it
        // treat the non-RSC body as an MPA navigation and assign `location` to
        // the *current* URL — cancelling the login navigation we just started
        // and, from the service worker cache, restarting the whole cycle. This
        // document is on its way out, so a promise that never settles is the
        // honest answer.
        return new Promise<Response>(() => {});
      }
      if (isServerFailure(res)) failedWith = res.status;
    } catch {
      // Any surprise inside the guard must not break the fetch.
      return res;
    }

    if (failedWith !== null) {
      reportServerError();
      // Throwing is what buys the retry: Next treats it as a connectivity
      // failure, parks the request, polls, and re-runs it once the server is
      // back — so recovery needs no reload and no user action. Returning the
      // response instead would let the router hard-assign `location`.
      throw new ServerUnavailableError(failedWith);
    }
    return res;
  };
}

installFetchGuard();

export function RequestGuard(): null {
  return null;
}
