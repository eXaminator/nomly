import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-unit-decider-"));
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

/**
 * The matcher's unit decider may only double candidates whose matching unit
 * was CURATED (alias default → ingredient default). The global default unit
 * exists to give unit-less LINES a unit — it must never hand uncurated
 * catalog entries a phantom unit that then "agrees" with a defaulted line
 * unit and doubles a weak name match past a strong one.
 *
 * Real-world shape this pins: "1 garlic clove crushed" must resolve to
 * Knoblauch (alias "garlic clove", curated unit Zehe, 2 exact tokens) and
 * not to Nelken (alias "cloves", no curated unit, 1 close-inflection token)
 * — previously Nelken's fallback Stück matched the line's defaulted Stück
 * and doubled 130 past Knoblauch's 250.
 */

let ids: {
  stueck: number;
  zehe: number;
  knoblauch: number;
  nelken: number;
};

beforeAll(async () => {
  const { db } = await import("@/db");
  const { ingredient, ingredientAlias, unit } = await import("@/db/schema");
  const { setGlobalDefaultUnitId } = await import(
    "@/lib/settings/global-default-unit"
  );

  const stueck = db
    .insert(unit)
    .values({ name: "Stück", dimension: "count", baseUnitId: null, factor: 1 })
    .returning({ id: unit.id })
    .all()[0].id;
  const zehe = db
    .insert(unit)
    .values({ name: "Zehe", dimension: "count", baseUnitId: null, factor: 1 })
    .returning({ id: unit.id })
    .all()[0].id;
  setGlobalDefaultUnitId(stueck);

  const knoblauch = db
    .insert(ingredient)
    .values({ name: "Knoblauch" })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const nelken = db
    .insert(ingredient)
    .values({ name: "Nelken" })
    .returning({ id: ingredient.id })
    .all()[0].id;
  db.insert(ingredientAlias)
    .values([
      { ingredientId: knoblauch, name: "garlic" },
      { ingredientId: knoblauch, name: "garlic clove", defaultUnitId: zehe },
      { ingredientId: knoblauch, name: "garlic cloves", defaultUnitId: zehe },
      { ingredientId: nelken, name: "cloves" },
      { ingredientId: nelken, name: "whole cloves" },
    ])
    .run();

  ids = { stueck, zehe, knoblauch, nelken };
});

describe("catalog matching unit is curated-only", () => {
  it("leaves entries without alias/ingredient default unit-less (no global fallback)", async () => {
    const { buildIngredientCatalog } = await import("@/lib/recipe-import");
    const catalog = buildIngredientCatalog();
    const byAlias = new Map(catalog.map((e) => [e.aliasName, e]));
    // Curated per-alias unit flows through …
    expect(byAlias.get("garlic clove")?.unitId).toBe(ids.zehe);
    // … but uncurated entries get NO unit, even with a global default set.
    expect(byAlias.get("cloves")?.unitId).toBeUndefined();
    expect(byAlias.get("garlic")?.unitId).toBeUndefined();
    expect(byAlias.get("Nelken")?.unitId).toBeUndefined();
  });

  it("a defaulted line unit cannot double an uncurated weak match past a curated strong one", async () => {
    const { buildIngredientCatalog, buildIngredientLookup, buildUnitLookup, parseIngredientLines } =
      await import("@/lib/recipe-import");
    const lookups = {
      units: buildUnitLookup(),
      ingredients: buildIngredientLookup(),
      ingredientCatalog: buildIngredientCatalog(),
    };
    const [row] = parseIngredientLines(["1 garlic clove crushed"], lookups);
    expect(row.ingredientId).toBe(ids.knoblauch);
    expect(row.name).toBe("garlic clove");
    expect(row.notes).toBe("crushed");
  });

  it("an explicit line unit still doubles a curated candidate (existing contract)", async () => {
    const { buildIngredientCatalog } = await import("@/lib/recipe-import");
    const { findIngredientCandidates } = await import(
      "@/lib/recipe-import/matching"
    );
    // "garlic cloves" hits Knoblauch (curated Zehe) and Nelken's "cloves"
    // (130, no unit). With the line unit Zehe, Knoblauch must lead — the
    // doubling rewards the curated agreement.
    const { matches } = findIngredientCandidates(
      "garlic cloves",
      buildIngredientCatalog(),
      { lineUnitId: ids.zehe },
    );
    expect(matches[0].ingredientId).toBe(ids.knoblauch);
  });
});

describe("collision advisory shows the curated unit only", () => {
  it("reports null for uncurated entries instead of the global default", async () => {
    const { findCrossIngredientAliasCollisions } = await import(
      "@/lib/stammdaten/ingredient/alias-collisions"
    );
    // What the matcher uses is what the curation UI must display: no curated
    // unit → no unit, NOT the global default ("Stück") it previously showed.
    const uncurated = findCrossIngredientAliasCollisions("cloves");
    expect(uncurated).toHaveLength(1);
    expect(uncurated[0].ingredientId).toBe(ids.nelken);
    expect(uncurated[0].unitName).toBeNull();

    const curated = findCrossIngredientAliasCollisions("garlic clove");
    expect(curated).toHaveLength(1);
    expect(curated[0].ingredientId).toBe(ids.knoblauch);
    expect(curated[0].unitName).toBe("Zehe");
  });
});
