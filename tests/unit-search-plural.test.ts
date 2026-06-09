import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-unit-search-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  const tmpDb = drizzle(sqlite);
  migrate(tmpDb, { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

beforeEach(async () => {
  const { db } = await import("@/db");
  const { unit, unitAlias } = await import("@/db/schema");
  db.delete(unitAlias).run();
  db.delete(unit).run();
});

describe("unit search matches plurals", () => {
  it("finds 'Cup' when searching its plural 'cups'", async () => {
    const { db } = await import("@/db");
    const { unit } = await import("@/db/schema");
    const id = db
      .insert(unit)
      .values({ name: "Cup", plural: "Cups", dimension: "volume", factor: 236.588 })
      .returning({ id: unit.id })
      .all()[0].id;

    const { searchUnitsWithAliases } = await import("@/lib/autocomplete");
    const hits = searchUnitsWithAliases("cups");
    // The plural query must surface the canonical Cup unit.
    expect(hits.some((h) => h.unitId === id)).toBe(true);
  });

  it("finds a unit by an alias plural", async () => {
    const { db } = await import("@/db");
    const { unit, unitAlias } = await import("@/db/schema");
    const id = db
      .insert(unit)
      .values({ name: "Esslöffel", plural: "Esslöffel", dimension: "volume", factor: 15 })
      .returning({ id: unit.id })
      .all()[0].id;
    db.insert(unitAlias).values({ unitId: id, name: "tablespoon", plural: "tablespoons" }).run();

    const { searchUnitsWithAliases } = await import("@/lib/autocomplete");
    const hits = searchUnitsWithAliases("tablespoons");
    expect(hits.some((h) => h.unitId === id)).toBe(true);
  });
});
