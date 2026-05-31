import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-unit-plural-svc-"));
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

let createUnit: typeof import("@/lib/stammdaten/unit/service").createUnit;
let updateUnit: typeof import("@/lib/stammdaten/unit/service").updateUnit;
let getUnitDetail: typeof import("@/lib/stammdaten/unit/service").getUnitDetail;

beforeAll(async () => {
  const svc = await import("@/lib/stammdaten/unit/service");
  createUnit = svc.createUnit;
  updateUnit = svc.updateUnit;
  getUnitDetail = svc.getUnitDetail;
});

describe("unit service — plurals round-trip", () => {
  it("persists the canonical plural and per-alias plurals", () => {
    const created = createUnit({
      name: "Dose",
      plural: "Dosen",
      aliases: ["can", "tin"],
      aliasPlurals: { can: "cans" },
      dimension: "count",
      baseUnitId: null,
      factor: 1,
      isContainer: true,
    });
    const detail = getUnitDetail(created.id)!;
    expect(detail.plural).toBe("Dosen");
    expect(detail.aliasPlurals).toEqual({ can: "cans" });
    expect(detail.aliases.sort()).toEqual(["can", "tin"]);
  });

  it("drops a plural for an alias that was removed and clears an emptied canonical plural", () => {
    const created = createUnit({
      name: "Glas",
      plural: "Gläser",
      aliases: ["jar"],
      aliasPlurals: { jar: "jars" },
      dimension: "count",
      baseUnitId: null,
      factor: 1,
      isContainer: true,
    });
    const updated = updateUnit(created.id, {
      name: "Glas",
      plural: "",
      aliases: ["jar"],
      aliasPlurals: {},
      dimension: "count",
      baseUnitId: null,
      factor: 1,
      isContainer: true,
    });
    expect(updated.plural).toBeNull();
    expect(updated.aliasPlurals).toEqual({});
  });
});
