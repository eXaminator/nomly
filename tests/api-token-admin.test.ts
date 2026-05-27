import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-api-token-admin-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  const tmpDb = drizzle(sqlite);
  migrate(tmpDb, { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { apiToken } = await import("@/db/schema");
  db.delete(apiToken).run();
});

describe("listApiTokens", () => {
  it("lists minted tokens newest-first without exposing the raw token", async () => {
    const { createApiToken, listApiTokens } = await import("@/lib/bearer");
    const a = createApiToken("first");
    const b = createApiToken("second");

    const list = listApiTokens();
    expect(list.map((t) => t.name)).toEqual(["second", "first"]);
    const row = list.find((t) => t.id === a.id)!;
    expect(row.lastUsedAt).toBeNull();
    expect(typeof row.createdAt).toBe("number");
    // The summary must not carry the secret in any field.
    expect(JSON.stringify(list)).not.toContain(a.token);
    expect(JSON.stringify(list)).not.toContain(b.token);
  });

  it("reflects last-used after the token authenticates", async () => {
    const { createApiToken, listApiTokens, verifyBearer } = await import("@/lib/bearer");
    const t = createApiToken("used");
    expect(verifyBearer(t.token)).not.toBeNull();
    const row = listApiTokens().find((r) => r.id === t.id)!;
    expect(row.lastUsedAt).not.toBeNull();
  });
});

describe("revokeApiToken", () => {
  it("revokes a token: verifyBearer rejects it AND it is hidden from the list", async () => {
    const { createApiToken, revokeApiToken, verifyBearer, listApiTokens } =
      await import("@/lib/bearer");
    const keep = createApiToken("keep");
    const t = createApiToken("to-revoke");
    revokeApiToken(t.id);

    // Auth is dead…
    expect(verifyBearer(t.token)).toBeNull();
    // …and the revoked token no longer appears in the list (treated as deleted),
    // while other active tokens remain.
    const ids = listApiTokens().map((r) => r.id);
    expect(ids).not.toContain(t.id);
    expect(ids).toContain(keep.id);
  });

  it("throws when the token does not exist", async () => {
    const { revokeApiToken } = await import("@/lib/bearer");
    expect(() => revokeApiToken(999999)).toThrow();
  });

  it("throws when revoking an already-revoked token", async () => {
    const { createApiToken, revokeApiToken } = await import("@/lib/bearer");
    const t = createApiToken("double");
    revokeApiToken(t.id);
    expect(() => revokeApiToken(t.id)).toThrow();
  });
});
