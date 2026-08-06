/**
 * Classifies an incoming request as "a top-level page load" versus "a fetch()
 * issued by client code" — the distinction the proxy needs before it may answer
 * with a cross-origin redirect to the IdP.
 *
 * Kept as a pure header/URL function (no `next/server` types) so it can be
 * unit-tested against the exact header shapes real browsers send.
 */

/** Query param Next appends to every RSC request (`NEXT_RSC_UNION_QUERY`). */
const RSC_QUERY_PARAM = "_rsc";

/**
 * `Sec-Fetch-Dest` values that are *not* a top-level document even though the
 * request is a navigation — a framed page must not be bounced to the IdP,
 * which refuses to be framed.
 */
const SUBFRAME_DESTINATIONS = new Set(["iframe", "frame", "embed", "object"]);

/**
 * True only for a request the browser will treat as a full-page navigation, so
 * a 307 to the (cross-origin) IdP is followed as a normal page load, free of
 * CORS.
 *
 * The signal is `Sec-Fetch-Mode: navigate`, **not** `Sec-Fetch-Dest: document`.
 * When our service worker re-issues a navigation with `fetch(event.request)`,
 * the Fetch spec downgrades the request's mode and Chrome drops the
 * destination: the server then sees `Sec-Fetch-Mode: navigate` but
 * `Sec-Fetch-Dest: empty`. Keying on the destination therefore misread every
 * SW-mediated page load as a background fetch and answered it with the JSON
 * 401 — the user saw `{"error":"unauthorized"}` instead of the login page.
 *
 * Client-issued fetches (RSC refresh, `<Link>` prefetch, API calls) are
 * `Sec-Fetch-Mode: cors`/`same-origin` and additionally carry the `_rsc` query
 * param or the RSC/prefetch headers. Old webviews send no `Sec-Fetch-*` at all
 * — fall back to the destination, then to `Accept`.
 */
export function isTopLevelNavigation(
  headers: Headers,
  searchParams: URLSearchParams,
): boolean {
  // An RSC payload request is never a page load, whatever the fetch metadata
  // says. Next 16 marks these with the `_rsc` query param; the `RSC` and
  // `Next-Router-Prefetch` headers cover older/other router paths.
  if (searchParams.has(RSC_QUERY_PARAM)) return false;
  if (headers.has("rsc") || headers.has("next-router-prefetch")) return false;

  const dest = headers.get("sec-fetch-dest");
  if (dest && SUBFRAME_DESTINATIONS.has(dest)) return false;

  const mode = headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  if (dest) return dest === "document";
  return (headers.get("accept") ?? "").includes("text/html");
}
