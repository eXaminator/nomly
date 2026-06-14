import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-qseed-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

describe("runSeed – quantifiers", () => {
  it("seeds canonical quantifiers and aliases correctly", async () => {
    const { runSeed } = await import("@/db/seed");
    const { buildQuantifierLookup } = await import("@/lib/recipe-import");

    const counts = runSeed();
    expect(counts.quantifiers.added).toBeGreaterThan(0);
    expect(counts.quantifiers.aliasesAdded).toBeGreaterThan(0);

    const lookup = buildQuantifierLookup();

    // zwei → 2
    const zweiEntry = lookup.byNameOrAlias.get("zwei");
    expect(zweiEntry).toBeDefined();
    expect(zweiEntry!.value).toBe(2);

    // alias "two" → 2
    const twoEntry = lookup.byNameOrAlias.get("two");
    expect(twoEntry).toBeDefined();
    expect(twoEntry!.id).toBe(zweiEntry!.id);
    expect(twoEntry!.value).toBe(2);

    // einige → null (unspecified)
    const einigeEntry = lookup.byNameOrAlias.get("einige");
    expect(einigeEntry).toBeDefined();
    expect(einigeEntry!.value).toBeNull();

    // alias "a" → 1 (alias of "ein")
    const aEntry = lookup.byNameOrAlias.get("a");
    expect(aEntry).toBeDefined();
    expect(aEntry!.value).toBe(1);
    expect(aEntry!.name).toBe("ein");
  });

  it("is idempotent (re-running runSeed does not crash; skipped counts > 0)", async () => {
    const { runSeed } = await import("@/db/seed");

    const counts2 = runSeed();
    expect(counts2.quantifiers.skipped).toBeGreaterThan(0);
    expect(counts2.quantifiers.added).toBe(0);
    // No crash = idempotent
  });
});
