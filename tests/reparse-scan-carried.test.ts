import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-reparse-carried-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.prepare("INSERT INTO unit (name, dimension, factor) VALUES ('EL', 'volume', 15)").run();
  const unitId = Number(sqlite.prepare("SELECT id FROM unit WHERE name = 'EL'").get()!.id);
  const oel = sqlite.prepare("INSERT INTO ingredient (name) VALUES ('Olivenöl')").run();
  const olivenId = Number(oel.lastInsertRowid);
  const raps = sqlite.prepare("INSERT INTO ingredient (name) VALUES ('Rapsöl')").run();
  const rapsId = Number(raps.lastInsertRowid);
  const r = sqlite.prepare("INSERT INTO recipe (title) VALUES ('R')").run();
  const recipeId = Number(r.lastInsertRowid);
  const s = sqlite
    .prepare("INSERT INTO recipe_section (recipe_id, sort_order) VALUES (?, 0)")
    .run(recipeId);
  const sectionId = Number(s.lastInsertRowid);
  // Primary the re-parse reproduces exactly.
  const prim = sqlite
    .prepare(
      `INSERT INTO recipe_ingredient
         (section_id, ingredient_id, display_name, quantity, unit_id, raw_line, sort_order)
       VALUES (?, ?, 'Olivenöl', 2, ?, '2 EL Olivenöl', 0)`,
    )
    .run(sectionId, olivenId, unitId);
  // A MANUAL alternative (empty raw_line) the parser never produces.
  sqlite
    .prepare(
      `INSERT INTO recipe_ingredient
         (section_id, ingredient_id, display_name, raw_line, alternative_for_id, sort_order)
       VALUES (?, ?, 'Rapsöl', '', ?, 1)`,
    )
    .run(sectionId, rapsId, Number(prim.lastInsertRowid));
  sqlite.close();
}

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

describe("scanAllRecipesForReparse — carried manual alternatives", () => {
  it("surfaces a manual alternative the re-parse doesn't reproduce, tagged carried", async () => {
    const { scanAllRecipesForReparse } = await import("@/lib/recipes/reparse-scan");
    const entries = await scanAllRecipesForReparse();
    // The only change is the manual alternative the parser doesn't reproduce —
    // it must still surface (so the user can see it would be removed).
    expect(entries.length).toBe(1);
    const carried = entries[0].proposed.filter((p) => p.carried);
    expect(carried.length).toBe(1);
    expect(carried[0].name).toBe("Rapsöl");
    expect(carried[0].isAlternative).toBe(true);
  });
});
