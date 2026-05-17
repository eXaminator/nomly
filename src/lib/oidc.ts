import * as client from "openid-client";
import { env } from "./env.ts";

let cached: Promise<client.Configuration> | null = null;

export function getOidcConfig(): Promise<client.Configuration> {
  if (!cached) {
    cached = client.discovery(
      new URL(env.OIDC_ISSUER),
      env.OIDC_CLIENT_ID,
      undefined,
      client.ClientSecretPost(env.OIDC_CLIENT_SECRET),
    );
  }
  return cached;
}

export function buildRedirectUri(): string {
  return new URL("/api/auth/callback", env.BASE_URL).toString();
}
