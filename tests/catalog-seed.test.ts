import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-catalog-seed-"));
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

// Shared setup: seed Tandoor + the real catalog once, then introspect.
let firstRunCounts: Awaited<
  ReturnType<typeof import("@/lib/familywall/seed-catalog").runFamilywallCatalogSeed>
>;
let secondRunCounts: typeof firstRunCounts;

beforeAll(async () => {
  const { runSeed } = await import("@/db/seed");
  const { runFamilywallCatalogSeed } = await import(
    "@/lib/familywall/seed-catalog"
  );
  runSeed();
  firstRunCounts = runFamilywallCatalogSeed();
  secondRunCounts = runFamilywallCatalogSeed();
});

describe("runFamilywallCatalogSeed", () => {
  it("parses every catalog entry without warnings", () => {
    expect(firstRunCounts.entries).toBeGreaterThan(700);
    expect(firstRunCounts.warnings).toEqual([]);
  });

  it("inserts every catalog entry as its canonical row", () => {
    // The catalog now owns ingredient identity end-to-end — every entry
    // becomes a canonical row on first seed. No rename / merge steps.
    expect(firstRunCounts.inserted).toBeGreaterThan(700);
    expect(firstRunCounts.aliasesAdded).toBeGreaterThan(1000);
    expect(firstRunCounts.subUnitsAdded).toBeGreaterThan(15);
    expect(firstRunCounts.subUnitAliasesAdded).toBeGreaterThan(40);
  });

  it("is idempotent on a second run", () => {
    expect(secondRunCounts.warnings).toEqual([]);
    expect(secondRunCounts.inserted).toBe(0);
    expect(secondRunCounts.aliasesAdded).toBe(0);
    expect(secondRunCounts.subUnitsAdded).toBe(0);
    expect(secondRunCounts.subUnitAliasesAdded).toBe(0);
  });

  it("creates 'Birne' and 'Pfirsich' as distinct canonical rows", async () => {
    const { db } = await import("@/db");
    const { ingredient } = await import("@/db/schema");
    const { sql } = await import("drizzle-orm");
    const rows = db
      .select({ id: ingredient.id, name: ingredient.name })
      .from(ingredient)
      .where(sql`name in (${"Birne"}, ${"Pfirsich"})`)
      .all();
    const byName = new Map(rows.map((r) => [r.name, r.id]));
    expect(byName.has("Birne")).toBe(true);
    expect(byName.has("Pfirsich")).toBe(true);
    expect(byName.get("Birne")).not.toBe(byName.get("Pfirsich"));
  });

  it("creates 'Paprika' and 'Paprikapulver' as distinct canonical rows", async () => {
    const { db } = await import("@/db");
    const { ingredient } = await import("@/db/schema");
    const { sql } = await import("drizzle-orm");
    const rows = db
      .select({ id: ingredient.id, name: ingredient.name })
      .from(ingredient)
      .where(sql`name in (${"Paprika"}, ${"Paprikapulver"})`)
      .all();
    const byName = new Map(rows.map((r) => [r.name, r.id]));
    expect(byName.has("Paprika")).toBe(true);
    expect(byName.has("Paprikapulver")).toBe(true);
  });

  it("attaches dietary class, category, and (when set) is_equipment", async () => {
    const { db } = await import("@/db");
    const { ingredient, category } = await import("@/db/schema");
    const { sql, eq } = await import("drizzle-orm");

    // Apfel — vegan + Obst und Gemüse, no equipment.
    const apfel = db
      .select({
        id: ingredient.id,
        name: ingredient.name,
        dietary: ingredient.dietaryClass,
        isEquipment: ingredient.isEquipment,
        categoryId: ingredient.defaultCategoryId,
      })
      .from(ingredient)
      .where(sql`name = ${"Apfel"}`)
      .get();
    expect(apfel?.dietary).toBe("vegan");
    expect(apfel?.isEquipment).toBe(false);
    const apfelCat = apfel?.categoryId
      ? db
          .select({ name: category.name })
          .from(category)
          .where(eq(category.id, apfel.categoryId))
          .get()
      : null;
    expect(apfelCat?.name).toBe("Obst und Gemüse");

    // Backpapier — NEW + equipment: true.
    const backpapier = db
      .select({
        name: ingredient.name,
        isEquipment: ingredient.isEquipment,
      })
      .from(ingredient)
      .where(sql`name = ${"Backpapier"}`)
      .get();
    expect(backpapier?.isEquipment).toBe(true);
  });

  it("promotes sub-units to global units and links the compound-noun aliases", async () => {
    const { db } = await import("@/db");
    const { ingredient, ingredientAlias, unit } = await import("@/db/schema");
    const { sql, eq, and } = await import("drizzle-orm");

    const apfel = db
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(sql`name = ${"Apfel"}`)
      .get();
    expect(apfel).toBeDefined();

    // The former "Scheibe" sub-unit is a global count unit now.
    const scheibe = db
      .select({ id: unit.id })
      .from(unit)
      .where(sql`name = ${"Scheibe"}`)
      .get();
    expect(scheibe).toBeDefined();

    // Compound-noun aliases point at the promoted unit via default_unit_id.
    const scheibeAliases = db
      .select({ name: ingredientAlias.name, defaultUnitId: ingredientAlias.defaultUnitId })
      .from(ingredientAlias)
      .where(
        and(
          eq(ingredientAlias.ingredientId, apfel!.id),
          eq(ingredientAlias.defaultUnitId, scheibe!.id),
        ),
      )
      .all();
    const aliasNames = scheibeAliases.map((a) => a.name);
    expect(aliasNames).toContain("Apfelscheibe");
    expect(aliasNames).toContain("apple slice");
  });

  it("creates a single Apfel canonical (no per-variety duplicate rows)", async () => {
    const { db } = await import("@/db");
    const { ingredient } = await import("@/db/schema");
    const { sql } = await import("drizzle-orm");

    // The catalog folds apple varieties into the single "Apfel" canonical
    // via aliases; the per-variety strings should NOT survive as standalone
    // ingredient rows.
    const variantNames = [
      "Äpfel",
      "Äpfel Gala",
      "Äpfel Granny Smith",
      "Äpfel Honeycrisp",
    ];
    const survivors = db
      .select({ name: ingredient.name })
      .from(ingredient)
      .where(sql`name in ${variantNames}`)
      .all();
    expect(survivors).toEqual([]);

    const apfel = db
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(sql`name = ${"Apfel"}`)
      .get();
    expect(apfel).toBeDefined();
  });
});
