import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import * as client from "openid-client";
import { sealData } from "iron-session";
import { getOidcConfig, buildRedirectUri } from "@/lib/oidc";
import { env } from "@/lib/env";

const STATE_COOKIE = "__nomly_oidc_state";
const STATE_TTL_SEC = 10 * 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") ?? "/";

  const config = await getOidcConfig();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  const authUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: buildRedirectUri(),
    scope: "openid profile email offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });

  const sealed = await sealData(
    { codeVerifier, state, nonce, next },
    { password: env.SESSION_SECRET, ttl: STATE_TTL_SEC },
  );

  const store = await cookies();
  store.set(STATE_COOKIE, sealed, {
    httpOnly: true,
    secure: env.BASE_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL_SEC,
  });

  return NextResponse.redirect(authUrl.toString());
}
