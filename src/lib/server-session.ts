import { cookies } from "next/headers";
import { getIronSession, type IronSession } from "iron-session";
import { sessionOptions, type SessionData } from "./session.ts";

/**
 * Next-only helper — reads the session from the App Router `cookies()` store.
 * Custom-server / Node-native code must use the (req, res) overload of
 * `getIronSession` directly with the imports from iron-session.
 */
export async function getSession(): Promise<IronSession<Partial<SessionData>>> {
  const store = await cookies();
  return getIronSession<Partial<SessionData>>(store, sessionOptions());
}
