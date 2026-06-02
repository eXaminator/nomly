import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-reparse-mutes-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

let recipeId: number;
{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  const r = sqlite.prepare("INSERT INTO recipe (title) VALUES ('R')").run();
  recipeId = Number(r.lastInsertRowid);
  const s = sqlite
    .prepare("INSERT INTO recipe_section (recipe_id, sort_order) VALUES (?, 0)")
    .run(recipeId);
  const sectionId = Number(s.lastInsertRowid);
  // Two distinct lines; we'll mute one of them.
  for (const [i, raw] of ["200 g Mehl", "3 Eier"].entries()) {
    sqlite
      .prepare(
        "INSERT INTO recipe_ingredient (section_id, display_name, raw_line, sort_order) VALUES (?, ?, ?, ?)",
      )
      .run(sectionId, raw, raw, i);
  }
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

let mutes: typeof import("@/lib/recipes/reparse-mutes");
let scan: typeof import("@/lib/recipes/reparse-scan").scanAllRecipesForReparse;
let resetCache: typeof import("@/lib/recipes/reparse-scan").__resetReparseParseCache;

beforeAll(async () => {
  mutes = await import("@/lib/recipes/reparse-mutes");
  const scanMod = await import("@/lib/recipes/reparse-scan");
  scan = scanMod.scanAllRecipesForReparse;
  resetCache = scanMod.__resetReparseParseCache;
});

describe("reparse mutes", () => {
  it("round-trips and is idempotent on (recipe, line)", () => {
    const a = mutes.addReparseMute(recipeId, "200 g Mehl");
    const b = mutes.addReparseMute(recipeId, "200 g Mehl"); // re-mute → same row
    expect(b.id).toBe(a.id);
    expect(mutes.listReparseMutes().filter((m) => m.rawLine === "200 g Mehl")).toHaveLength(1);

    const set = mutes.loadMuteSet();
    expect(set.lines.has(`${recipeId} 200 g Mehl`)).toBe(true);
    expect(set.recipes.has(recipeId)).toBe(false);

    mutes.removeReparseMute(a.id);
    expect(mutes.listReparseMutes().some((m) => m.id === a.id)).toBe(false);
  });

  it("scan excludes a line-muted group, and a recipe-muted recipe entirely", async () => {
    resetCache();
    const baseline = await scan();
    const baseCount = baseline.filter((e) => e.recipeId === recipeId).length;
    expect(baseCount).toBeGreaterThan(0);

    // Mute one line: that group disappears from the scan.
    resetCache();
    const lineMute = mutes.addReparseMute(recipeId, "200 g Mehl");
    const afterLine = await scan();
    expect(afterLine.some((e) => e.recipeId === recipeId && e.rawLine === "200 g Mehl")).toBe(
      false,
    );
    mutes.removeReparseMute(lineMute.id);

    // Mute the whole recipe: no entries for it at all.
    resetCache();
    const recipeMute = mutes.addReparseMute(recipeId, null);
    const afterRecipe = await scan();
    expect(afterRecipe.some((e) => e.recipeId === recipeId)).toBe(false);
    mutes.removeReparseMute(recipeMute.id);
  });
});
