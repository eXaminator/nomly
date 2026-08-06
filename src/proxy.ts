import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, isSessionLive, type SessionData } from "@/lib/session";
import { extractBearer, verifyBearer, type TokenScope } from "@/lib/bearer";
import { isTopLevelNavigation } from "@/lib/request-kind";
import { renewSessionIfStale } from "@/lib/session-renewal";
import {
  EMBED_COOKIE_NAME,
  embedCookieOptions,
  frameAncestorsCsp,
  isEmbedAllowedPath,
  readEmbedSession,
  sealEmbedSession,
} from "@/lib/embed-session";

const BYPASS_PREFIXES = ["/api/auth/", "/api/health", "/_next/", "/favicon"];
const BYPASS_EXACT = new Set([
  "/manifest.webmanifest",
  "/robots.txt",
  "/sw.js",
  "/sw-precache.json",
  // The static offline fallback the SW caches — must succeed (not redirect to
  // login) whenever the SW precaches it, even if the session has expired.
  "/offline",
  // The PWA entry redirect — must succeed (not bounce to login) so the SW
  // can precache it and launch offline; it carries no data, the target page
  // enforces auth itself.
  "/start",
]);

function isBypassed(pathname: string): boolean {
  if (BYPASS_EXACT.has(pathname)) return true;
  return BYPASS_PREFIXES.some((p) => pathname.startsWith(p));
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function isEmbedPath(pathname: string): boolean {
  return pathname === "/embed" || pathname.startsWith("/embed/");
}

/** Allow the request through, stamping the frame-ancestors CSP on the response. */
function allow(res: NextResponse = NextResponse.next()): NextResponse {
  res.headers.set("content-security-policy", frameAncestorsCsp());
  return res;
}

/**
 * Gate a request for a verified principal by its scope. "full" reaches
 * everything; "embed" is confined to the embed allow-list (reads plus the
 * needs-update flag toggle).
 */
function authorizeScope(
  scope: TokenScope,
  pathname: string,
  method: string,
): NextResponse {
  if (scope === "full") return allow();
  if (isEmbedAllowedPath(pathname, method)) return allow();
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isBypassed(pathname)) return NextResponse.next();

  // Path 1: live OIDC session cookie → full access.
  const res = NextResponse.next();
  const session = await getIronSession<Partial<SessionData>>(
    request,
    res,
    sessionOptions(),
  );
  if (isSessionLive(session)) {
    // Spend the refresh token once the session goes stale so an actively used
    // session never ages out from under the user. Best-effort: a failed
    // renewal leaves the (still live) session untouched.
    if (await renewSessionIfStale(session)) {
      await session.save();
    }
    return allow(res);
  }

  // Path 2: Authorization bearer token → access gated by the token's scope.
  const token = extractBearer(request.headers.get("authorization"));
  if (token) {
    const principal = verifyBearer(token);
    if (principal) {
      return authorizeScope(principal.scope, pathname, request.method);
    }
  }

  // Path 3: embed-token exchange. Only on /embed/** paths, and only for an
  // embed-scoped token — full tokens must never travel in a URL. Validate it,
  // mint the sealed embed cookie, then redirect to the same URL minus `k` so
  // the raw token leaves the visible URL / webview history.
  if (isEmbedPath(pathname)) {
    const k = request.nextUrl.searchParams.get("k");
    if (k) {
      const principal = verifyBearer(k);
      if (principal && principal.scope === "embed") {
        const clean = new URL(request.url);
        clean.searchParams.delete("k");
        const redirect = NextResponse.redirect(clean);
        const sealed = await sealEmbedSession({
          tokenId: principal.tokenId,
          scope: principal.scope,
        });
        redirect.cookies.set(EMBED_COOKIE_NAME, sealed, embedCookieOptions());
        return redirect;
      }
    }
  }

  // Path 4: established embed cookie → embed-scoped access (allow-list only).
  const embed = await readEmbedSession(
    request.cookies.get(EMBED_COOKIE_NAME)?.value,
  );
  if (embed) {
    return authorizeScope(embed.scope, pathname, request.method);
  }

  // Path 5: reject. Only a top-level navigation is redirected to the IdP — the
  // browser follows that as a full-page load (no CORS). A fetch()/RSC/prefetch
  // request must NOT be redirected cross-origin: the browser would follow the
  // 307 chain to Authentik in `cors` mode, Authentik sends no
  // `Access-Control-Allow-Origin`, and the fetch dies with a CORS error. Next
  // then hard-reloads, the service worker re-serves the cached page, and the
  // refresh fires again — an endless reload loop. Answer those with a
  // same-origin 401 plus a re-auth hint the client turns into a single
  // top-level navigation to login (see components/auth/session-guard.tsx).
  if (
    isApiPath(pathname)
    || !isTopLevelNavigation(request.headers, request.nextUrl.searchParams)
  ) {
    const res = NextResponse.json({ error: "unauthorized" }, { status: 401 });
    res.headers.set("x-nomly-reauth", "1");
    return res;
  }
  const loginUrl = new URL("/api/auth/login", request.url);
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
