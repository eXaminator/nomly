import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-reparse-unassigned-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  // Legacy unassigned row: unlinked before the save path cleared amount/unit,
  // so the stale quantity/unit are still stored on the row.
  sqlite.prepare("INSERT INTO unit (name, dimension) VALUES ('EL', 'volume')").run();
  const unitId = Number(
    sqlite.prepare("SELECT id FROM unit WHERE name = 'EL'").get()!.id,
  );
  const r = sqlite.prepare("INSERT INTO recipe (title) VALUES ('R')").run();
  const recipeId = Number(r.lastInsertRowid);
  const s = sqlite
    .prepare("INSERT INTO recipe_section (recipe_id, sort_order) VALUES (?, 0)")
    .run(recipeId);
  const sectionId = Number(s.lastInsertRowid);
  sqlite
    .prepare(
      `INSERT INTO recipe_ingredient
         (section_id, ingredient_id, display_name, quantity, unit_id, display_unit, raw_line, sort_order)
       VALUES (?, NULL, 'Reste vom Buffet', 2, ?, 'EL', '2 EL Olivenöl', 0)`,
    )
    .run(sectionId, unitId);
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("scanAllRecipesForReparse — unassigned current rows", () => {
  it("masks the stale amount/unit on an unassigned current row", async () => {
    const { scanAllRecipesForReparse } = await import(
      "@/lib/recipes/reparse-scan"
    );
    const entries = await scanAllRecipesForReparse();
    expect(entries.length).toBe(1);
    const cur = entries[0].current[0];
    expect(cur.ingredientId).toBeNull();
    expect(cur.name).toBe("Reste vom Buffet");
    // Unassigned lines are pure text — the dialog's "Aktuell" side must not
    // resurrect the amount/unit left over from before the unlink.
    expect(cur.quantity).toBeNull();
    expect(cur.unitLabel).toBeNull();
  });
});
