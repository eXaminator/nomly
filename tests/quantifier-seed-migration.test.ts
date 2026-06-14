import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { SEED_QUANTIFIERS } from "@/db/seed-data/quantifiers";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-quantifier-seed-"));
const dbPath = join(tempDir, "test.db");

let sqlite: Database.Database;

beforeAll(() => {
  sqlite = new Database(dbPath);
  // Migrations are the *only* thing that runs on container start (the seed is
  // never invoked from the entrypoint), so a fresh DB must come out of the
  // migrator with the default quantifiers already present.
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
});

afterAll(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("quantifier defaults seeded by migration", () => {
  it("creates every curated quantifier", () => {
    const rows = sqlite
      .prepare("SELECT name, value FROM quantifier")
      .all() as Array<{ name: string; value: number | null }>;
    const byName = new Map(rows.map((r) => [r.name, r.value]));

    for (const q of SEED_QUANTIFIERS) {
      expect(byName.has(q.name), `missing quantifier "${q.name}"`).toBe(true);
      expect(byName.get(q.name)).toBe(q.value);
    }
  });

  it("creates the curated aliases", () => {
    const aliases = new Set(
      (
        sqlite.prepare("SELECT name FROM quantifier_alias").all() as Array<{
          name: string;
        }>
      ).map((r) => r.name),
    );
    // Spot-check a few that the matcher relies on across languages/inflections.
    for (const alias of ["two", "twelve", "several", "a few", "eine"]) {
      expect(aliases.has(alias), `missing alias "${alias}"`).toBe(true);
    }
  });

  it("re-running the migrator does not duplicate rows (idempotent / runs once)", () => {
    const before = (
      sqlite.prepare("SELECT count(*) AS c FROM quantifier").get() as {
        c: number;
      }
    ).c;
    migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
    const after = (
      sqlite.prepare("SELECT count(*) AS c FROM quantifier").get() as {
        c: number;
      }
    ).c;
    expect(after).toBe(before);
  });
});
