import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import * as client from "openid-client";
import { unsealData } from "iron-session";
import { buildRedirectUri, getOidcConfig } from "@/lib/oidc";
import { env } from "@/lib/env";
import { getSession } from "@/lib/server-session";
import type { SessionData } from "@/lib/session";
import { upsertUserFromSession } from "@/lib/users/service";

const STATE_COOKIE = "__nomly_oidc_state";

type StateData = {
  codeVerifier: string;
  state: string;
  nonce: string;
  next: string;
};

export async function GET(request: Request) {
  const store = await cookies();
  const sealed = store.get(STATE_COOKIE)?.value;
  if (!sealed) {
    return NextResponse.json(
      { error: "Missing OIDC state cookie" },
      { status: 400 },
    );
  }
  const stateData = await unsealData<StateData>(sealed, {
    password: env.SESSION_SECRET,
  });
  store.delete(STATE_COOKIE);

  const config = await getOidcConfig();

  // Reassemble the callback URL using BASE_URL so it matches the redirect_uri
  // we sent during /authorize — Next sees the raw host header (e.g.
  // 0.0.0.0:3000 when bound that way), but the IdP only knows BASE_URL.
  const incoming = new URL(request.url);
  const callbackUrl = new URL(buildRedirectUri());
  for (const [k, v] of incoming.searchParams) callbackUrl.searchParams.set(k, v);

  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: stateData.codeVerifier,
    expectedState: stateData.state,
    expectedNonce: stateData.nonce,
  });

  const claims = tokens.claims();
  if (!claims?.sub) {
    return NextResponse.json(
      { error: "OIDC token has no sub claim" },
      { status: 400 },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const session = await getSession();
  const data: SessionData = {
    sub: claims.sub,
    name:
      (typeof claims.name === "string" && claims.name) ||
      (typeof claims.preferred_username === "string" && claims.preferred_username) ||
      (typeof claims.email === "string" && claims.email) ||
      claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    exp: typeof claims.exp === "number" ? claims.exp : now + 3600,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    issuedAt: now,
  };
  Object.assign(session, data);
  await session.save();

  // Mirror the OIDC identity into the local user table (creating + seeding
  // favorites on first login, refreshing name + last_login afterwards).
  upsertUserFromSession({ sub: data.sub, name: data.name, lastLoginAt: now });

  const nextPath =
    stateData.next.startsWith("/") && !stateData.next.startsWith("//")
      ? stateData.next
      : "/";
  return NextResponse.redirect(new URL(nextPath, env.BASE_URL));
}
