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
  it("imports the Tandoor snapshot and is idempotent on rerun", async () => {
    const { runSeed } = await import("@/db/seed");
    const { db } = await import("@/db");
    const { ingredient, unit, category, supermarket } = await import(
      "@/db/schema"
    );

    const first = runSeed();
    expect(first.units.added).toBeGreaterThanOrEqual(10);
    expect(first.categories.added).toBeGreaterThanOrEqual(20);
    expect(first.ingredients.added).toBeGreaterThanOrEqual(300);
    expect(first.supermarkets.added).toBeGreaterThanOrEqual(50);

    const units = db.select().from(unit).all();
    const cats = db.select().from(category).all();
    const ings = db.select().from(ingredient).all();
    const markets = db.select().from(supermarket).all();
    expect(units.length).toBe(first.units.added);
    expect(cats.length).toBe(first.categories.added);
    expect(ings.length).toBe(first.ingredients.added);
    expect(markets.length).toBe(first.supermarkets.added);

    const second = runSeed();
    expect(second.units.added).toBe(0);
    expect(second.units.skipped).toBe(first.units.added);
    expect(second.ingredients.added).toBe(0);
    expect(second.supermarkets.added).toBe(0);
  });
});

beforeAll(() => {
  // Hook to silence unused-import warning if needed in future.
});
