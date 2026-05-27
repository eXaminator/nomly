import { createHash, randomBytes } from "node:crypto";
import { eq, isNull, and, desc } from "drizzle-orm";
import { db } from "../db/index.ts";
import { apiToken } from "../db/schema.ts";

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export type MintedToken = {
  /** DB row id of the new api_token. */
  id: number;
  /** Human label stored with the token. */
  name: string;
  /** The raw token — shown ONCE; only its hash is persisted. */
  token: string;
};

/**
 * Create a new machine API token. Returns the raw token to hand to the
 * caller (e.g. the import CLI); the DB only ever stores its sha256 hash.
 */
export function createApiToken(name: string): MintedToken {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error("token name is required");
  const raw = randomBytes(32).toString("base64url");
  const inserted = db
    .insert(apiToken)
    .values({ name: trimmed, tokenHash: hashToken(raw) })
    .returning({ id: apiToken.id })
    .all();
  return { id: inserted[0].id, name: trimmed, token: raw };
}

export type BearerPrincipal = {
  kind: "machine";
  tokenId: number;
  name: string;
};

export function verifyBearer(rawToken: string): BearerPrincipal | null {
  const hash = hashToken(rawToken);
  const row = db
    .select()
    .from(apiToken)
    .where(and(eq(apiToken.tokenHash, hash), isNull(apiToken.revokedAt)))
    .get();
  if (!row) return null;

  db.update(apiToken)
    .set({ lastUsedAt: Math.floor(Date.now() / 1000) })
    .where(eq(apiToken.id, row.id))
    .run();

  return { kind: "machine", tokenId: row.id, name: row.name };
}

export function extractBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  return m ? m[1].trim() : null;
}

export class ApiTokenError extends Error {
  code: "not_found" | "invalid_name";
  status: number;
  constructor(code: "not_found" | "invalid_name", message: string, status: number) {
    super(message);
    this.name = "ApiTokenError";
    this.code = code;
    this.status = status;
  }
}

export type ApiTokenSummary = {
  id: number;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
};

/**
 * Active tokens only, newest first. Revoked tokens are treated as deleted —
 * they keep their row (so the hash can never be reused) but never surface in
 * the list. Never includes the secret (only the hash is stored).
 */
export function listApiTokens(): ApiTokenSummary[] {
  return db
    .select({
      id: apiToken.id,
      name: apiToken.name,
      createdAt: apiToken.createdAt,
      lastUsedAt: apiToken.lastUsedAt,
    })
    .from(apiToken)
    .where(isNull(apiToken.revokedAt))
    .orderBy(desc(apiToken.createdAt), desc(apiToken.id))
    .all();
}

/** Revoke an active token. Throws if it doesn't exist or is already revoked. */
export function revokeApiToken(id: number): void {
  const result = db
    .update(apiToken)
    .set({ revokedAt: Math.floor(Date.now() / 1000) })
    .where(and(eq(apiToken.id, id), isNull(apiToken.revokedAt)))
    .run();
  if (result.changes === 0) {
    throw new ApiTokenError("not_found", "Token nicht gefunden oder bereits widerrufen", 404);
  }
}
