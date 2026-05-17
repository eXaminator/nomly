import { createHash } from "node:crypto";
import { eq, isNull, and } from "drizzle-orm";
import { db } from "../db/index.ts";
import { apiToken } from "../db/schema.ts";

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
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
