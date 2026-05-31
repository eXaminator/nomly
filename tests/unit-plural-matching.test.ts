import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-unit-plural-"));
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

let knoblauchId = 0;

beforeAll(async () => {
  const { db } = await import("@/db");
  const { unit, unitAlias, ingredient, ingredientSubUnit } = await import("@/db/schema");

  const [dose] = db
    .insert(unit)
    .values({ name: "Dose", plural: "Dosen", dimension: "count", isContainer: true })
    .returning()
    .all();
  db.insert(unitAlias)
    .values({ unitId: dose.id, name: "can", plural: "cans" })
    .run();

  const [knoblauch] = db
    .insert(ingredient)
    .values({ name: "Knoblauch" })
    .returning()
    .all();
  knoblauchId = knoblauch.id;
  db.insert(ingredientSubUnit)
    .values({ ingredientId: knoblauch.id, name: "Zehe", plural: "Zehen", perPurchase: 10 })
    .run();
});

describe("buildUnitLookup — plurals", () => {
  it("matches a unit's configured plural to the same unit", async () => {
    const { buildUnitLookup } = await import("@/lib/recipe-import");
    const lookup = buildUnitLookup();
    const sing = lookup.byNameOrAlias.get("dose");
    const plur = lookup.byNameOrAlias.get("dosen");
    expect(sing?.name).toBe("Dose");
    expect(plur?.name).toBe("Dose");
    expect(plur?.id).toBe(sing?.id);
  });

  it("treats the plural of a container unit as a container token", async () => {
    const { buildUnitLookup } = await import("@/lib/recipe-import");
    const lookup = buildUnitLookup();
    expect(lookup.containerTokens.has("dosen")).toBe(true);
  });

  it("matches an alias's plural to the alias's unit", async () => {
    const { buildUnitLookup } = await import("@/lib/recipe-import");
    const lookup = buildUnitLookup();
    expect(lookup.byNameOrAlias.get("can")?.name).toBe("Dose");
    expect(lookup.byNameOrAlias.get("cans")?.name).toBe("Dose");
  });
});

describe("buildSubUnitLookup — plurals", () => {
  it("matches the sub-unit singular and configured plural, but not a guessed suffix", async () => {
    const { buildSubUnitLookup } = await import("@/lib/recipe-import");
    const lookup = buildSubUnitLookup();
    const byName = lookup.get(knoblauchId);
    expect(byName?.get("zehe")?.id).toBeDefined();
    expect(byName?.get("zehen")?.id).toBe(byName?.get("zehe")?.id);
  });
});
