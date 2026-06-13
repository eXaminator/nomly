import { eq } from "drizzle-orm";

import { db } from "@/db";
import { user } from "@/db/schema";
import { getSession } from "@/lib/server-session";
import { upsertUserFromSession, type UserRow } from "./service";

/** The session fields the user-ensure logic needs. */
type SessionLike = { sub?: string; name?: string };

/**
 * Ensure a local user row exists for the given session, creating it (and
 * seeding favorites) on first sight. Returns null when the session has no
 * identity. Does NOT bump `last_login_at` for an existing row — that's the OIDC
 * callback's job; this only guarantees the row exists so already-logged-in
 * users (whose session predates the user table, or who were removed) get a row
 * on their next page view.
 */
export function ensureUserFromSession(session: SessionLike): UserRow | null {
  if (!session.sub || !session.name) return null;
  const existing = db.select().from(user).where(eq(user.sub, session.sub)).get();
  if (existing) return existing;
  return upsertUserFromSession({
    sub: session.sub,
    name: session.name,
    lastLoginAt: Math.floor(Date.now() / 1000),
  });
}

/** Resolve the local user row for the current request's session. Creates it on
 *  first sight (see {@link ensureUserFromSession}). */
export async function getCurrentUser(): Promise<UserRow | null> {
  return ensureUserFromSession(await getSession());
}
