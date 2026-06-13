import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-reparse-reconcile-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  const g = sqlite.prepare("INSERT INTO ingredient (name) VALUES ('Gurke')").run();
  const gurkeId = Number(g.lastInsertRowid);
  const r = sqlite.prepare("INSERT INTO recipe (title) VALUES ('R')").run();
  const recipeId = Number(r.lastInsertRowid);
  const s = sqlite
    .prepare("INSERT INTO recipe_section (recipe_id, sort_order) VALUES (?, 0)")
    .run(recipeId);
  const sectionId = Number(s.lastInsertRowid);
  // Primary the re-parse reproduces. Both rows share the full source line.
  const prim = sqlite
    .prepare(
      `INSERT INTO recipe_ingredient
         (section_id, ingredient_id, display_name, raw_line, sort_order)
       VALUES (?, ?, 'Gurke', 'Gurke oder Schmackofatz', 0)`,
    )
    .run(sectionId, gurkeId);
  // A promoted-from-pill alternative: NOT in the catalog (the parser folds it as
  // a "potential"), but the user promoted it to a row and saved. It carries the
  // SAME source line (a real source-line alternative, not a manual one).
  sqlite
    .prepare(
      `INSERT INTO recipe_ingredient
         (section_id, ingredient_id, display_name, raw_line, alternative_for_id, sort_order)
       VALUES (?, NULL, 'Schmackofatz', 'Gurke oder Schmackofatz', ?, 1)`,
    )
    .run(sectionId, Number(prim.lastInsertRowid));
  sqlite.close();
}

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

describe("scanAllRecipesForReparse — reconcile promoted potentials", () => {
  it("does not propose removing a saved member that matches a parser potential", async () => {
    const { scanAllRecipesForReparse } = await import("@/lib/recipes/reparse-scan");
    const { __resetReparseParseCache } = await import("@/lib/recipes/reparse-scan");
    __resetReparseParseCache();
    const entries = await scanAllRecipesForReparse();
    // The saved "Schmackofatz" matches the parser's folded potential, so it is
    // reconciled (force-emitted) and the group reads as UNCHANGED — no diff,
    // and crucially nothing is proposed-for-removal.
    const carried = entries.flatMap((e) => e.proposed.filter((p) => p.carried && p.name === "Schmackofatz"));
    expect(carried).toEqual([]);
  });
});
