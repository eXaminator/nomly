import { eq } from "drizzle-orm";

import { db } from "@/db";
import { user } from "@/db/schema";
import { getSession } from "@/lib/server-session";
import { upsertUserFromSession, type UserRow } from "./service";

/**
 * Resolve the local user row for the current session, creating it (and seeding
 * favorites) on first sight — so an already-logged-in user who predates the
 * user table gets a row on their next page load. Returns null when there's no
 * session. Does NOT bump `last_login_at` on every read; that happens at the
 * OIDC callback.
 */
export async function getCurrentUser(): Promise<UserRow | null> {
  const session = await getSession();
  if (!session.sub || !session.name) return null;
  const existing = db.select().from(user).where(eq(user.sub, session.sub)).get();
  if (existing) return existing;
  return upsertUserFromSession({
    sub: session.sub,
    name: session.name,
    lastLoginAt: Math.floor(Date.now() / 1000),
  });
}
