import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-api-token-"));
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

describe("createApiToken", () => {
  it("mints a token that verifyBearer accepts, returning the principal", async () => {
    const { createApiToken, verifyBearer } = await import("@/lib/bearer");
    const minted = createApiToken("import-cli");
    expect(minted.token.length).toBeGreaterThan(20);

    const principal = verifyBearer(minted.token);
    expect(principal).not.toBeNull();
    expect(principal?.kind).toBe("machine");
    expect(principal?.name).toBe("import-cli");
    expect(principal?.tokenId).toBe(minted.id);
  });

  it("does not store the raw token (only its hash is persisted)", async () => {
    const { createApiToken, hashToken } = await import("@/lib/bearer");
    const { db } = await import("@/db");
    const { apiToken } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const minted = createApiToken("hash-check");
    const row = db
      .select()
      .from(apiToken)
      .where(eq(apiToken.id, minted.id))
      .get();
    expect(row?.tokenHash).toBe(hashToken(minted.token));
    expect(row?.tokenHash).not.toBe(minted.token);
  });

  it("rejects an unknown token", async () => {
    const { verifyBearer } = await import("@/lib/bearer");
    expect(verifyBearer("definitely-not-a-real-token")).toBeNull();
  });
});
