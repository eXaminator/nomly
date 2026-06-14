/**
 * Fix A: isLineGroupChanged must treat a pure literal→quantifier change (or
 * quantifier→literal) as a diff even when the effective number is the same.
 *
 * We test this two ways:
 *  1. Unit tests of the pure `isLineGroupChanged` helper — imported lazily to
 *     avoid loading @/db before the temp DATABASE_URL is set.
 *  2. A real temp-DB scan: a recipe ingredient stored with a quantifier_id
 *     is re-parsed as a plain literal (the parser doesn't see the word-form
 *     because no quantifier alias is seeded that matches the digit "2"),
 *     which must surface as a changed group.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

// Set up the temp DB BEFORE any @/ imports so that @/db picks up the path.
const tempDir = mkdtempSync(join(tmpdir(), "nomly-reparse-quantifier-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });

  // Migrations now seed the default quantifiers; this test needs a controlled
  // single-quantifier fixture, so clear the table before inserting it.
  sqlite.exec("DELETE FROM quantifier_alias; DELETE FROM quantifier;");

  // Seed a quantifier ("zwei", value=2) — no alias that matches "2" as a word,
  // so the parser will emit a plain numeric literal for "2 Mehl".
  const q = sqlite
    .prepare("INSERT INTO quantifier (name, value, sort_order) VALUES ('zwei', 2, 0)")
    .run();
  const quantifierId = Number(q.lastInsertRowid);

  const ing = sqlite
    .prepare("INSERT INTO ingredient (name) VALUES ('Mehl')")
    .run();
  const ingredientId = Number(ing.lastInsertRowid);
  // Seed the ingredient alias so the parser can match it by name.
  sqlite
    .prepare("INSERT INTO ingredient_alias (ingredient_id, name) VALUES (?, 'Mehl')")
    .run(ingredientId);

  const r = sqlite.prepare("INSERT INTO recipe (title) VALUES ('R')").run();
  const recipeId = Number(r.lastInsertRowid);
  const s = sqlite
    .prepare("INSERT INTO recipe_section (recipe_id, sort_order) VALUES (?, 0)")
    .run(recipeId);
  const sectionId = Number(s.lastInsertRowid);

  // Stored row: quantifier reference (id=quantifierId), quantity=null.
  // The raw_line "2 Mehl" will be re-parsed as a plain literal quantity=2
  // (no word-form alias maps "2" → the quantifier "zwei").
  sqlite
    .prepare(
      `INSERT INTO recipe_ingredient
         (section_id, ingredient_id, display_name, quantifier_id, quantity, raw_line, sort_order)
       VALUES (?, ?, 'Mehl', ?, NULL, '2 Mehl', 0)`,
    )
    .run(sectionId, ingredientId, quantifierId);

  sqlite.close();
}

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Part 1: pure unit tests of isLineGroupChanged (dynamic import avoids loading
// @/db at module-init time before the temp DB path is in the environment).
// ---------------------------------------------------------------------------

describe("isLineGroupChanged — quantifierId comparison", () => {
  it("false when both sides have no quantifier (baseline)", async () => {
    const { isLineGroupChanged } = await import("@/lib/recipes/reparse-scan");
    expect(
      isLineGroupChanged(
        [{ id: 1, ingredientId: 5, name: "Mehl", quantity: 2, quantityLow: null, quantifierId: null, unitId: null, notes: null, isOptional: false, alternativeForId: null }],
        [{ quantity: 2, quantityLow: null, unit: null, unitMatch: "empty", rawUnit: null, name: "Mehl", ingredientId: 5, ingredientMatch: "existing", canonicalIngredientName: null, notes: null, isOptional: false, fixedAmount: false, isAlternative: false }],
      ),
    ).toBe(false);
  });

  it("true when stored row has no quantifier but parser returns one (literal→quantifier)", async () => {
    const { isLineGroupChanged } = await import("@/lib/recipes/reparse-scan");
    expect(
      isLineGroupChanged(
        [{ id: 1, ingredientId: 5, name: "Mehl", quantity: 2, quantityLow: null, quantifierId: null, unitId: null, notes: null, isOptional: false, alternativeForId: null }],
        [{ quantity: 2, quantityLow: null, quantifierId: 7, quantifierName: "zwei", unit: null, unitMatch: "empty", rawUnit: null, name: "Mehl", ingredientId: 5, ingredientMatch: "existing", canonicalIngredientName: null, notes: null, isOptional: false, fixedAmount: false, isAlternative: false }],
      ),
    ).toBe(true);
  });

  it("true when stored row has a quantifier but parser returns a plain literal (quantifier→literal)", async () => {
    const { isLineGroupChanged } = await import("@/lib/recipes/reparse-scan");
    expect(
      isLineGroupChanged(
        [{ id: 1, ingredientId: 5, name: "Mehl", quantity: null, quantityLow: null, quantifierId: 7, unitId: null, notes: null, isOptional: false, alternativeForId: null }],
        [{ quantity: 2, quantityLow: null, quantifierId: null, unit: null, unitMatch: "empty", rawUnit: null, name: "Mehl", ingredientId: 5, ingredientMatch: "existing", canonicalIngredientName: null, notes: null, isOptional: false, fixedAmount: false, isAlternative: false }],
      ),
    ).toBe(true);
  });

  it("true when stored quantifier id differs from proposed quantifier id", async () => {
    const { isLineGroupChanged } = await import("@/lib/recipes/reparse-scan");
    expect(
      isLineGroupChanged(
        [{ id: 1, ingredientId: 5, name: "Mehl", quantity: null, quantityLow: null, quantifierId: 7, unitId: null, notes: null, isOptional: false, alternativeForId: null }],
        [{ quantity: 3, quantityLow: null, quantifierId: 8, quantifierName: "drei", unit: null, unitMatch: "empty", rawUnit: null, name: "Mehl", ingredientId: 5, ingredientMatch: "existing", canonicalIngredientName: null, notes: null, isOptional: false, fixedAmount: false, isAlternative: false }],
      ),
    ).toBe(true);
  });

  it("false when both sides reference the same quantifier id (no diff)", async () => {
    const { isLineGroupChanged } = await import("@/lib/recipes/reparse-scan");
    // Both sides: quantifierId=7, quantity=null. The effective amount is owned
    // by the quantifier — no literal to compare, so this is not a change.
    expect(
      isLineGroupChanged(
        [{ id: 1, ingredientId: 5, name: "Mehl", quantity: null, quantityLow: null, quantifierId: 7, unitId: null, notes: null, isOptional: false, alternativeForId: null }],
        [{ quantity: null, quantityLow: null, quantifierId: 7, quantifierName: "zwei", unit: null, unitMatch: "empty", rawUnit: null, name: "Mehl", ingredientId: 5, ingredientMatch: "existing", canonicalIngredientName: null, notes: null, isOptional: false, fixedAmount: false, isAlternative: false }],
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Part 2: real DB scan — stored quantifier_id, re-parsed as plain literal
// ---------------------------------------------------------------------------

describe("scanAllRecipesForReparse — quantifier→literal change surfaces", () => {
  it("surfaces a group whose stored quantifier_id now parses as a plain literal", async () => {
    const { scanAllRecipesForReparse, __resetReparseParseCache } = await import(
      "@/lib/recipes/reparse-scan"
    );
    __resetReparseParseCache();
    const entries = await scanAllRecipesForReparse();
    // The current row has quantifier_id set; the re-parser emits a plain
    // numeric quantity with no quantifier → must surface as a diff.
    expect(entries.length).toBe(1);
    const entry = entries[0];
    // Current side: has a quantifier reference.
    expect(typeof entry.current[0].quantifierId).toBe("number");
    // Proposed side: no quantifier (parser saw "2" as a literal).
    const proposed = entry.proposed[0];
    expect(proposed.quantifierId ?? null).toBeNull();
    expect(proposed.quantity).toBe(2);
  });
});
