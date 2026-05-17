import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { env } from "./env";

export type SessionData = {
  sub: string;
  name: string;
  email?: string;
  /** absolute unix-seconds expiry of the OIDC id_token */
  exp: number;
  /** access_token, kept for userinfo / api calls if ever needed */
  accessToken?: string;
  /** refresh_token, used for silent renewal */
  refreshToken?: string;
  /** unix-seconds when we last refreshed the session from the IdP */
  issuedAt: number;
};

const COOKIE_NAME = "__nomly_session";

export function sessionOptions(): SessionOptions {
  const isHttps = env.BASE_URL.startsWith("https://");
  return {
    cookieName: COOKIE_NAME,
    password: env.SESSION_SECRET,
    ttl: 60 * 60 * 24 * 90, // 90 days absolute
    cookieOptions: {
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    },
  };
}

export async function getSession(): Promise<IronSession<Partial<SessionData>>> {
  const store = await cookies();
  return getIronSession<Partial<SessionData>>(store, sessionOptions());
}

/** Inactivity timeout: 30 days since last refresh. */
const INACTIVITY_TTL_SEC = 60 * 60 * 24 * 30;
/** Refresh from IdP if session is older than 30 minutes. */
export const REFRESH_AT_SEC = 60 * 30;

export function isSessionLive(s: Partial<SessionData>): s is SessionData {
  if (!s.sub || !s.issuedAt) return false;
  const now = Math.floor(Date.now() / 1000);
  if (now - s.issuedAt > INACTIVITY_TTL_SEC) return false;
  return true;
}
