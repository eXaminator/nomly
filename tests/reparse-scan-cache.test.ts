import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-reparse-cache-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  // Minimal fixture: one recipe with two sections-worth of lines, plus a
  // duplicate raw line across rows so within-scan dedup is exercised.
  const r = sqlite.prepare("INSERT INTO recipe (title) VALUES ('R')").run();
  const recipeId = Number(r.lastInsertRowid);
  const s = sqlite
    .prepare("INSERT INTO recipe_section (recipe_id, sort_order) VALUES (?, 0)")
    .run(recipeId);
  const sectionId = Number(s.lastInsertRowid);
  const lines = ["200 g Mehl", "3 Eier", "200 g Mehl", "1 Prise Salz"];
  lines.forEach((raw, i) => {
    sqlite
      .prepare(
        "INSERT INTO recipe_ingredient (section_id, display_name, raw_line, sort_order) VALUES (?, ?, ?, ?)",
      )
      .run(sectionId, raw.replace(/^[\d.,]+\s*\w*\s*/, ""), raw, i);
  });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

let scan: typeof import("@/lib/recipes/reparse-scan").scanAllRecipesForReparse;
let reset: typeof import("@/lib/recipes/reparse-scan").__resetReparseParseCache;
let invocations: typeof import("@/lib/recipes/reparse-scan").__getReparseParseInvocations;

beforeAll(async () => {
  const mod = await import("@/lib/recipes/reparse-scan");
  scan = mod.scanAllRecipesForReparse;
  reset = mod.__resetReparseParseCache;
  invocations = mod.__getReparseParseInvocations;
});

describe("reparse scan parse cache", () => {
  it("dedupes within a scan and reuses across reopens", async () => {
    reset();
    const first = await scan();
    const firstInvocations = invocations();
    // 4 rows but only 3 distinct raw lines → the duplicate "200 g Mehl"
    // parses once within the scan.
    expect(firstInvocations).toBe(3);

    const second = await scan();
    // Catalog unchanged → the second scan parses nothing.
    expect(invocations()).toBe(firstInvocations);
    expect(second.length).toBe(first.length);
  });
});
