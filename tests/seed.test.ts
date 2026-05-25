import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-seed-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

// Apply migrations BEFORE importing the app DB module — its module-init
// connects via process.env.DATABASE_URL.
{
  const sqlite = new Database(process.env.DATABASE_URL);
  const tmpDb = drizzle(sqlite);
  migrate(tmpDb, { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("seed transform", () => {
  it("inserts curated units + categories and is idempotent on rerun", async () => {
    const { runSeed } = await import("@/db/seed");
    const { db } = await import("@/db");
    const { ingredient, unit, category, supermarket } = await import(
      "@/db/schema"
    );

    const first = runSeed();
    // SEED_UNITS plus the topUpUnits the app needs (containers etc.).
    expect(first.units.added).toBeGreaterThanOrEqual(10);
    // SEED_CATEGORIES (supermarket-style) plus the household top-ups.
    expect(first.categories.added).toBeGreaterThanOrEqual(20);

    const units = db.select().from(unit).all();
    const cats = db.select().from(category).all();
    const ings = db.select().from(ingredient).all();
    const markets = db.select().from(supermarket).all();
    expect(units.length).toBe(first.units.added);
    expect(cats.length).toBe(first.categories.added);
    // Ingredient rows are owned by the catalog seed — runSeed leaves them
    // untouched so the table is empty after this pass.
    expect(ings.length).toBe(0);
    // Seeder doesn't touch supermarkets — the table stays empty until the
    // user adds one via the settings UI.
    expect(markets.length).toBe(0);

    const second = runSeed();
    expect(second.units.added).toBe(0);
    expect(second.units.skipped).toBe(first.units.added);
    expect(second.categories.added).toBe(0);
  });
});

beforeAll(() => {
  // Hook to silence unused-import warning if needed in future.
});
