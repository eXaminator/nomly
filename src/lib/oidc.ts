import * as client from "openid-client";
import { env } from "./env.ts";

let cached: Promise<client.Configuration> | null = null;

export function getOidcConfig(): Promise<client.Configuration> {
  if (!cached) {
    cached = client
      .discovery(
        new URL(env.OIDC_ISSUER),
        env.OIDC_CLIENT_ID,
        undefined,
        client.ClientSecretBasic(env.OIDC_CLIENT_SECRET),
      )
      // Never cache a rejection: a single blip while the IdP is down would
      // otherwise poison discovery until the process restarts — and silent
      // session renewal now calls this on the request path.
      .catch((err: unknown) => {
        cached = null;
        throw err;
      });
  }
  return cached;
}

export function buildRedirectUri(): string {
  return new URL("/api/auth/callback", env.BASE_URL).toString();
}
