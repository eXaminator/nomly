import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-unspecific-service-"));
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
  const { unit, unitAlias } = await import("@/db/schema");
  db.delete(unitAlias).run();
  db.delete(unit).run();
});

describe("createUnit — unspecific", () => {
  it("stores unspecific and forces factor=1, baseUnitId=null", async () => {
    const { createUnit, getUnitDetail } = await import(
      "@/lib/stammdaten/unit/service"
    );
    const created = createUnit({
      name: "etwas",
      aliases: ["a sprinkle"],
      dimension: "mass",
      baseUnitId: 999, // would 404 if not normalized away
      factor: 42,
      isContainer: false,
      displayFraction: false,
      unspecific: true,
    });
    expect(created.unspecific).toBe(true);
    const detail = getUnitDetail(created.id)!;
    expect(detail.unspecific).toBe(true);
    expect(detail.factor).toBe(1);
    expect(detail.baseUnitId).toBeNull();
    expect(detail.aliases).toContain("a sprinkle");
  });

  it("leaves a normal unit's factor and dimension untouched", async () => {
    const { createUnit, getUnitDetail } = await import(
      "@/lib/stammdaten/unit/service"
    );
    const created = createUnit({
      name: "kg",
      aliases: [],
      dimension: "mass",
      baseUnitId: null,
      factor: 1000,
      isContainer: false,
      displayFraction: false,
      unspecific: false,
    });
    const detail = getUnitDetail(created.id)!;
    expect(detail.unspecific).toBe(false);
    expect(detail.factor).toBe(1000);
  });
});
