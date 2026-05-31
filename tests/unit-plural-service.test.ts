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
let getImpactForUnits: typeof import("@/lib/stammdaten/unit/service").getImpactForUnits;

beforeAll(async () => {
  const svc = await import("@/lib/stammdaten/unit/service");
  createUnit = svc.createUnit;
  updateUnit = svc.updateUnit;
  getUnitDetail = svc.getUnitDetail;
  getImpactForUnits = svc.getImpactForUnits;
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

describe("getImpactForUnits — linked ingredient conversions", () => {
  it("lists every article whose conversions reference the unit, on either side", async () => {
    const { db } = await import("@/db");
    const { ingredient, ingredientUnitConversion } = await import("@/db/schema");

    const stueck = createUnit({
      name: "Stück (impact)",
      plural: null,
      aliases: [],
      aliasPlurals: {},
      dimension: "count",
      baseUnitId: null,
      factor: 1,
      isContainer: false,
    });
    const zehe = createUnit({
      name: "Zehe (impact)",
      plural: "Zehen",
      aliases: [],
      aliasPlurals: {},
      dimension: "count",
      baseUnitId: null,
      factor: 1,
      isContainer: false,
    });

    const [knoblauch] = db
      .insert(ingredient)
      .values({ name: "Knoblauch (impact)" })
      .returning()
      .all();
    // 1 Stück = 10 Zehen — references both units.
    db.insert(ingredientUnitConversion)
      .values({
        ingredientId: knoblauch.id,
        fromUnitId: stueck.id,
        toUnitId: zehe.id,
        factor: 10,
        isContainer: true,
      })
      .run();

    // Both endpoints surface the article in their "Verwendung".
    for (const unitId of [stueck.id, zehe.id]) {
      const [impact] = getImpactForUnits([unitId]);
      const link = impact.linkedIngredients?.find((l) => l.id === knoblauch.id);
      expect(link, `unit ${unitId} should list Knoblauch`).toBeDefined();
      expect(link!.conversions).toContainEqual({
        fromUnitName: "Stück (impact)",
        toUnitName: "Zehe (impact)",
        factor: 10,
        isContainer: true,
      });
    }
  });

  it("returns an empty list for a unit no conversion references", () => {
    const lonely = createUnit({
      name: "Prise (impact)",
      plural: null,
      aliases: [],
      aliasPlurals: {},
      dimension: "mass",
      baseUnitId: null,
      factor: 1,
      isContainer: false,
    });
    const [impact] = getImpactForUnits([lonely.id]);
    expect(impact.linkedIngredients).toEqual([]);
  });
});
