import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-staples-subunit-"));
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

async function seed() {
  const { db } = await import("@/db");
  const { ingredient, ingredientSubUnit, stapleGroup } = await import("@/db/schema");
  db.delete(stapleGroup).run();
  db.delete(ingredientSubUnit).run();
  db.delete(ingredient).run();

  const ing = db
    .insert(ingredient)
    .values({ name: "Tomaten" })
    .returning({ id: ingredient.id })
    .all()[0];
  const sub = db
    .insert(ingredientSubUnit)
    .values({ ingredientId: ing.id, name: "Dose" })
    .returning({ id: ingredientSubUnit.id })
    .all()[0];
  const group = db
    .insert(stapleGroup)
    .values({ name: "Vorrat" })
    .returning({ id: stapleGroup.id })
    .all()[0];
  return { ingredientId: ing.id, subUnitId: sub.id, groupId: group.id };
}

beforeEach(seed);

describe("staple group items with sub-units", () => {
  it("stores and returns a sub-unit on the item", async () => {
    const { ingredientId, subUnitId, groupId } = await seed();
    const { addGroupItem, getGroup } = await import("@/lib/staples/groups");

    addGroupItem(groupId, { ingredientId, quantity: 2, subUnitId });

    const detail = getGroup(groupId);
    const item = detail!.items[0];
    expect(item.subUnitId).toBe(subUnitId);
    expect(item.subUnitName).toBe("Dose");
    expect(item.unitId).toBeNull();
    expect(item.quantity).toBe(2);
  });

  it("accepts quantity paired with a sub-unit (no plain unit required)", async () => {
    const { ingredientId, subUnitId, groupId } = await seed();
    const { addGroupItem } = await import("@/lib/staples/groups");
    expect(() =>
      addGroupItem(groupId, { ingredientId, quantity: 3, subUnitId }),
    ).not.toThrow();
  });

  it("rejects setting both a unit and a sub-unit", async () => {
    const { db } = await import("@/db");
    const { unit } = await import("@/db/schema");
    const u = db
      .insert(unit)
      .values({ name: "g", dimension: "mass", factor: 1 })
      .returning({ id: unit.id })
      .all()[0];
    const { ingredientId, subUnitId, groupId } = await seed();
    const { addGroupItem } = await import("@/lib/staples/groups");
    expect(() =>
      addGroupItem(groupId, { ingredientId, quantity: 1, unitId: u.id, subUnitId }),
    ).toThrow();
  });
});
