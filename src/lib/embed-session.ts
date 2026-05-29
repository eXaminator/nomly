import { sealData, unsealData } from "iron-session";
import { env } from "./env.ts";
import type { TokenScope } from "./bearer.ts";

/**
 * The Home Assistant recipe iframe authenticates with an API token that
 * arrives in the URL (`?k=`), since an <iframe src> can't send an
 * Authorization header. `proxy.ts` exchanges that token once for this sealed,
 * httpOnly cookie and strips the token from the URL — so the raw token never
 * lingers in webview history. The cookie is short-lived but re-minted on every
 * HA open (the iframe src still carries the token), so it self-heals after any
 * idle period. The durable credential is the token in HA's config, not this.
 */
export const EMBED_COOKIE_NAME = "__nomly_embed";

/** Cookie TTL. Short on purpose — see the module comment. */
export const EMBED_TTL_SEC = 60 * 60 * 12; // 12h

export type EmbedSessionData = {
  /** The api_token row this session was minted from. */
  tokenId: number;
  /** The token's scope (normally "embed"). */
  scope: TokenScope;
  /** unix-seconds when the cookie was sealed. */
  issuedAt: number;
};

export async function sealEmbedSession(input: {
  tokenId: number;
  scope: TokenScope;
}): Promise<string> {
  const payload: EmbedSessionData = {
    tokenId: input.tokenId,
    scope: input.scope,
    issuedAt: Math.floor(Date.now() / 1000),
  };
  return sealData(payload, { password: env.SESSION_SECRET, ttl: EMBED_TTL_SEC });
}

/** Unseal + validate the embed cookie. Returns null when absent/expired/tampered. */
export async function readEmbedSession(
  sealed: string | null | undefined,
): Promise<EmbedSessionData | null> {
  if (!sealed) return null;
  try {
    const data = await unsealData<EmbedSessionData>(sealed, {
      password: env.SESSION_SECRET,
      ttl: EMBED_TTL_SEC,
    });
    if (
      !data ||
      typeof data.tokenId !== "number" ||
      typeof data.issuedAt !== "number"
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** Cookie attributes for the embed session — shape accepted by `NextResponse.cookies.set`. */
export function embedCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: env.BASE_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: EMBED_TTL_SEC,
  };
}

/**
 * `Content-Security-Policy: frame-ancestors` value. Always allows 'self';
 * appends `EMBED_FRAME_ANCESTORS` origins (e.g. the Home Assistant origin) when
 * configured. This both tightens the app's previously wide-open framing and
 * permits the HA embed.
 */
export function frameAncestorsCsp(): string {
  const extra = env.EMBED_FRAME_ANCESTORS?.trim();
  const sources = extra ? `'self' ${extra}` : "'self'";
  return `frame-ancestors ${sources}`;
}

/**
 * What an "embed"-scoped principal may reach. Deliberately tiny: the embed
 * recipe pages, and GET on recipe photos (the <img> in the embed view).
 * Everything else is denied — the embed token is read-only by construction.
 */
export function isEmbedAllowedPath(pathname: string, method: string): boolean {
  if (pathname === "/embed" || pathname.startsWith("/embed/")) return true;
  if (
    method === "GET" &&
    (pathname === "/api/v1/photos" || pathname.startsWith("/api/v1/photos/"))
  ) {
    return true;
  }
  return false;
}
