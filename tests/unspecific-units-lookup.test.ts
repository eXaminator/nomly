import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-unspecific-lookup-"));
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

beforeAll(async () => {
  const { db } = await import("@/db");
  const { unit, unitAlias } = await import("@/db/schema");

  const [etwas] = db
    .insert(unit)
    .values({ name: "etwas", dimension: "count", factor: 1, unspecific: true })
    .returning()
    .all();
  db.insert(unitAlias).values({ unitId: etwas.id, name: "a sprinkle" }).run();
  db.insert(unit).values({ name: "g", dimension: "mass", factor: 1 }).run();
});

describe("buildUnitLookup — unspecific units", () => {
  it("collects unspecific tokens (name + alias) but not normal units", async () => {
    const { buildUnitLookup } = await import("@/lib/recipe-import");
    const lookup = buildUnitLookup();
    expect(lookup.unspecificTokens.has("etwas")).toBe(true);
    expect(lookup.unspecificTokens.has("a sprinkle")).toBe(true);
    expect(lookup.unspecificTokens.has("g")).toBe(false);
  });

  it("derives the max unit token width from the widest alias", async () => {
    const { buildUnitLookup } = await import("@/lib/recipe-import");
    const lookup = buildUnitLookup();
    expect(lookup.maxUnitTokens).toBe(2); // "a sprinkle"
  });
});
