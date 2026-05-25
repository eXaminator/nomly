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

  it("inserts NEW canonicals, renames Tandoor anchors, and merges duplicates", () => {
    expect(firstRunCounts.inserted).toBeGreaterThan(300);
    expect(firstRunCounts.renamed).toBeGreaterThan(50);
    // 10 documented secondary food-keys across the 6 merge entries.
    expect(firstRunCounts.mergedAway).toBe(10);
    expect(firstRunCounts.aliasesAdded).toBeGreaterThan(1000);
    expect(firstRunCounts.subUnitsAdded).toBeGreaterThan(15);
    expect(firstRunCounts.subUnitAliasesAdded).toBeGreaterThan(40);
  });

  it("is idempotent on a second run", () => {
    expect(secondRunCounts.warnings).toEqual([]);
    expect(secondRunCounts.inserted).toBe(0);
    expect(secondRunCounts.renamed).toBe(0);
    expect(secondRunCounts.mergedAway).toBe(0);
    expect(secondRunCounts.aliasesAdded).toBe(0);
    expect(secondRunCounts.subUnitsAdded).toBe(0);
    expect(secondRunCounts.subUnitAliasesAdded).toBe(0);
  });

  it("renames buggy food-pear-raw row 'Pfirsich' → 'Birne' and inserts a fresh peach 'Pfirsich'", async () => {
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

  it("renames food-spices-paprika 'Paprika' → 'Paprikapulver' and keeps 'Paprika' as the fresh-pepper canonical", async () => {
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
    // The 'Paprika, gelb' / 'Paprika, rot' Tandoor rows must be merged away.
    const variants = db
      .select({ name: ingredient.name })
      .from(ingredient)
      .where(sql`name in (${"Paprika, gelb"}, ${"Paprika, rot"})`)
      .all();
    expect(variants).toEqual([]);
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

  it("inserts sub-units and the sub-unit-aliased ingredient_alias rows", async () => {
    const { db } = await import("@/db");
    const { ingredient, ingredientAlias, ingredientSubUnit } = await import(
      "@/db/schema"
    );
    const { sql, eq, and } = await import("drizzle-orm");

    const apfel = db
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(sql`name = ${"Apfel"}`)
      .get();
    expect(apfel).toBeDefined();

    const subUnits = db
      .select()
      .from(ingredientSubUnit)
      .where(eq(ingredientSubUnit.ingredientId, apfel!.id))
      .all();
    expect(subUnits.find((s) => s.name === "Scheibe")).toBeDefined();
    expect(subUnits.find((s) => s.name === "Scheibe")?.perPurchase).toBe(8);

    const scheibeAliases = db
      .select({ name: ingredientAlias.name })
      .from(ingredientAlias)
      .where(
        and(
          eq(ingredientAlias.ingredientId, apfel!.id),
          sql`${ingredientAlias.defaultSubUnitId} is not null`,
        ),
      )
      .all();
    const aliasNames = scheibeAliases.map((a) => a.name);
    expect(aliasNames).toContain("Apfelscheibe");
    expect(aliasNames).toContain("apple slice");
  });

  it("sets purchaseUnit to Kolben for Mais", async () => {
    const { db } = await import("@/db");
    const { ingredient, unit } = await import("@/db/schema");
    const { sql, eq } = await import("drizzle-orm");

    const mais = db
      .select({ purchaseUnitId: ingredient.purchaseUnitId })
      .from(ingredient)
      .where(sql`name = ${"Mais"}`)
      .get();
    expect(mais?.purchaseUnitId).toBeDefined();
    const u = db
      .select({ name: unit.name })
      .from(unit)
      .where(eq(unit.id, mais!.purchaseUnitId!))
      .get();
    expect(u?.name).toBe("Kolben");
  });

  it("merges Apfel variants (Gala/Granny/Honeycrisp/Fuji) into a single canonical row", async () => {
    const { db } = await import("@/db");
    const { ingredient } = await import("@/db/schema");
    const { sql } = await import("drizzle-orm");

    // The four Tandoor variant rows (Äpfel Gala / Granny Smith / Honeycrisp,
    // and the original Äpfel from food-apples-fuji-with-skin-raw) must all
    // collapse into one canonical "Apfel". They should NOT survive as their
    // own ingredient rows.
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
