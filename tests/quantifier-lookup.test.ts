import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-qlookupt-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

describe("buildQuantifierLookup", () => {
  it("resolves canonical name and alias, passes value through, computes maxTokens", async () => {
    const { db } = await import("@/db");
    const { quantifier, quantifierAlias } = await import("@/db/schema");
    const { buildQuantifierLookup } = await import("@/lib/recipe-import");

    // Insert two quantifiers manually.
    const [einRow] = db
      .insert(quantifier)
      .values({ name: "ein", value: 1, sortOrder: 0 })
      .returning({ id: quantifier.id })
      .all();
    const [einPaarRow] = db
      .insert(quantifier)
      .values({ name: "ein paar", value: null, sortOrder: 1 })
      .returning({ id: quantifier.id })
      .all();

    // Aliases
    db.insert(quantifierAlias).values({ quantifierId: einRow.id, name: "eine" }).run();
    db.insert(quantifierAlias).values({ quantifierId: einRow.id, name: "one" }).run();
    db.insert(quantifierAlias).values({ quantifierId: einPaarRow.id, name: "a few" }).run();

    const lookup = buildQuantifierLookup();

    // Canonical name resolves
    const einEntry = lookup.byNameOrAlias.get("ein");
    expect(einEntry).toBeDefined();
    expect(einEntry!.id).toBe(einRow.id);
    expect(einEntry!.name).toBe("ein");
    expect(einEntry!.value).toBe(1);

    // Alias resolves to same entry
    const oneEntry = lookup.byNameOrAlias.get("one");
    expect(oneEntry).toBeDefined();
    expect(oneEntry!.id).toBe(einRow.id);
    expect(oneEntry!.value).toBe(1);

    // Null value passes through
    const einPaarEntry = lookup.byNameOrAlias.get("ein paar");
    expect(einPaarEntry).toBeDefined();
    expect(einPaarEntry!.value).toBeNull();

    // Multi-word alias "a few" → maxTokens >= 2
    expect(lookup.maxTokens).toBeGreaterThanOrEqual(2);

    // byId resolves
    expect(lookup.byId.get(einRow.id)?.name).toBe("ein");
    expect(lookup.byId.get(einPaarRow.id)?.name).toBe("ein paar");
  });
});
