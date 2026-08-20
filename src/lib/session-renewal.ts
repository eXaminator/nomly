import * as client from "openid-client";
import type { IronSession } from "iron-session";
import { getOidcConfig } from "./oidc.ts";
import { REFRESH_AT_SEC, type SessionData } from "./session.ts";

/**
 * Silent OIDC renewal.
 *
 * The login callback stores the IdP's `refresh_token` (we ask for
 * `offline_access`), but nothing ever spent it — so `issuedAt` was frozen at
 * login time and `isSessionLive`'s "30 days since last refresh" degenerated
 * into a hard 30-day cap. Every user got logged out a month after signing in,
 * mid-use, which is what surfaces as the expired-session reload loop.
 *
 * This renews the session against the IdP once it is older than
 * `REFRESH_AT_SEC`, which both re-validates the user (a disabled account stops
 * refreshing) and slides `issuedAt` forward, making the 30-day window the
 * genuine *inactivity* timeout it always claimed to be.
 */

/**
 * In-flight renewals keyed by `sub`. A page load fires a document request plus
 * a handful of RSC/API requests at once; without this they would all race to
 * spend the same refresh token, and an IdP that rotates refresh tokens would
 * reject all but one.
 */
const inFlight = new Map<string, Promise<Partial<SessionData> | null>>();

/** How long a refresh token that just failed is left alone before we retry. */
const RETRY_AFTER_SEC = 5 * 60;

/**
 * Refresh tokens whose last renewal attempt failed, mapped to the unix-seconds
 * timestamp at which they may be tried again.
 *
 * Without this a token the IdP has retired for good — `invalid_grant`, which is
 * what a rotated-but-never-persisted token becomes — is re-spent on *every*
 * request: the session stays live for the full inactivity window, `isStale()`
 * stays true because `issuedAt` never moves, and the proxy awaits a doomed
 * token round trip before it will serve anything. One failing IdP call per page
 * load is a latency floor the user feels, and it buries the logs.
 *
 * Keyed by the token rather than by `sub` so that signing in again — which
 * mints a fresh token — is never held back by the dead one's cooldown.
 */
const cooldown = new Map<string, number>();

function inCooldown(refreshToken: string, now: number): boolean {
  const until = cooldown.get(refreshToken);
  if (until === undefined) return false;
  if (until > now) return true;
  cooldown.delete(refreshToken);
  return false;
}

function startCooldown(refreshToken: string, now: number): void {
  // Rotation means a failed token is never seen again, so sweep the expired
  // entries on the way past to keep the map from growing without bound.
  for (const [token, until] of cooldown) {
    if (until <= now) cooldown.delete(token);
  }
  cooldown.set(refreshToken, now + RETRY_AFTER_SEC);
}

function isStale(session: Partial<SessionData>, now: number): boolean {
  return !session.issuedAt || now - session.issuedAt >= REFRESH_AT_SEC;
}

async function requestRenewal(
  refreshToken: string,
  now: number,
): Promise<Partial<SessionData> | null> {
  const config = await getOidcConfig();
  const tokens = await client.refreshTokenGrant(config, refreshToken);
  const claims = tokens.claims();
  return {
    accessToken: tokens.access_token,
    // Authentik (and most IdPs) may rotate the refresh token — keep the new
    // one when offered, otherwise the old one stays valid.
    refreshToken: tokens.refresh_token ?? refreshToken,
    exp: typeof claims?.exp === "number" ? claims.exp : now + 3600,
    issuedAt: now,
  };
}

/**
 * Refresh `session` in place when it is due, and report whether anything
 * changed (i.e. whether the caller must `save()` to re-seal the cookie).
 *
 * Failure is deliberately silent: a flaky IdP must not log anyone out. The
 * session keeps running on its existing `issuedAt` and a later request tries
 * again once the token's cooldown lapses; only a refresh token the IdP has
 * genuinely retired lets the session age out of the inactivity window.
 */
export async function renewSessionIfStale(
  session: IronSession<Partial<SessionData>>,
  now: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { sub, refreshToken } = session;
  if (!sub || !refreshToken) return false;
  if (!isStale(session, now)) return false;
  if (inCooldown(refreshToken, now)) return false;

  let pending = inFlight.get(sub);
  if (!pending) {
    pending = requestRenewal(refreshToken, now).catch((err: unknown) => {
      startCooldown(refreshToken, now);
      console.warn("[auth] silent session renewal failed", err);
      return null;
    });
    inFlight.set(sub, pending);
    void pending.finally(() => {
      if (inFlight.get(sub) === pending) inFlight.delete(sub);
    });
  }

  const renewed = await pending;
  if (!renewed) return false;
  Object.assign(session, renewed);
  return true;
}
