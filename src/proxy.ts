import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, isSessionLive, type SessionData } from "@/lib/session";
import { extractBearer, verifyBearer } from "@/lib/bearer";

const BYPASS_PREFIXES = ["/api/auth/", "/api/health", "/_next/", "/favicon"];
const BYPASS_EXACT = new Set([
  "/manifest.webmanifest",
  "/robots.txt",
  "/sw.js",
  "/sw-precache.json",
  // The static offline fallback the SW caches — must succeed (not redirect to
  // login) whenever the SW precaches it, even if the session has expired.
  "/offline",
]);

function isBypassed(pathname: string): boolean {
  if (BYPASS_EXACT.has(pathname)) return true;
  return BYPASS_PREFIXES.some((p) => pathname.startsWith(p));
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isBypassed(pathname)) return NextResponse.next();

  // Path 1: session cookie
  const res = NextResponse.next();
  const session = await getIronSession<Partial<SessionData>>(
    request,
    res,
    sessionOptions(),
  );
  if (isSessionLive(session)) {
    return res;
  }

  // Path 2: bearer token
  const token = extractBearer(request.headers.get("authorization"));
  if (token && verifyBearer(token)) {
    return NextResponse.next();
  }

  // Path 3: reject
  if (isApiPath(pathname)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const loginUrl = new URL("/api/auth/login", request.url);
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
