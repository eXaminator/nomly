import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-global-default-unit-"));
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

let getGlobalDefaultUnitId: typeof import("@/lib/settings/global-default-unit").getGlobalDefaultUnitId;
let setGlobalDefaultUnitId: typeof import("@/lib/settings/global-default-unit").setGlobalDefaultUnitId;

beforeAll(async () => {
  const mod = await import("@/lib/settings/global-default-unit");
  getGlobalDefaultUnitId = mod.getGlobalDefaultUnitId;
  setGlobalDefaultUnitId = mod.setGlobalDefaultUnitId;
});

describe("global default unit setting", () => {
  it("round-trips a unit id and switches over on re-set", () => {
    setGlobalDefaultUnitId(14);
    expect(getGlobalDefaultUnitId()).toBe(14);
    // Switch-over: a second set overwrites, never errors / duplicates.
    setGlobalDefaultUnitId(22);
    expect(getGlobalDefaultUnitId()).toBe(22);
  });
});
