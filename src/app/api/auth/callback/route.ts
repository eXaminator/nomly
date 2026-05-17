import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import * as client from "openid-client";
import { unsealData } from "iron-session";
import { getOidcConfig } from "@/lib/oidc";
import { env } from "@/lib/env";
import { getSession, type SessionData } from "@/lib/session";

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

  const tokens = await client.authorizationCodeGrant(config, new URL(request.url), {
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

  const nextPath =
    stateData.next.startsWith("/") && !stateData.next.startsWith("//")
      ? stateData.next
      : "/";
  return NextResponse.redirect(new URL(nextPath, env.BASE_URL));
}
