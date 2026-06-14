import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-quantifier-service-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  const tmpDb = drizzle(sqlite);
  migrate(tmpDb, { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { recipeIngredient, recipeSection, recipe, quantifierAlias, quantifier } =
    await import("@/db/schema");
  db.delete(recipeIngredient).run();
  db.delete(recipeSection).run();
  db.delete(recipe).run();
  db.delete(quantifierAlias).run();
  db.delete(quantifier).run();
});

/** Insert a recipe + section and return a fresh section id usable as the
 *  required `section_id` FK on a recipe_ingredient row. */
async function makeSection(): Promise<number> {
  const { db } = await import("@/db");
  const { recipe, recipeSection } = await import("@/db/schema");
  const r = db.insert(recipe).values({ title: "T" }).returning({ id: recipe.id }).all();
  const s = db
    .insert(recipeSection)
    .values({ recipeId: r[0].id })
    .returning({ id: recipeSection.id })
    .all();
  return s[0].id;
}

describe("createQuantifier / listQuantifiersManaged", () => {
  it("creates a quantifier listed with aliases, value, and recipeRefCount 0", async () => {
    const { createQuantifier, listQuantifiersManaged } = await import(
      "@/lib/stammdaten/quantifier/service"
    );
    const created = createQuantifier({
      name: "ein paar",
      value: 3,
      aliases: ["paar", "einige"],
    });
    expect(created.name).toBe("ein paar");
    expect(created.value).toBe(3);
    expect(created.aliases.sort()).toEqual(["einige", "paar"]);
    expect(created.recipeRefCount).toBe(0);

    const list = listQuantifiersManaged();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
    expect(list[0].value).toBe(3);
    expect(list[0].aliases.sort()).toEqual(["einige", "paar"]);
    expect(list[0].recipeRefCount).toBe(0);
  });

  it("allows a null value (vague quantifier)", async () => {
    const { createQuantifier } = await import(
      "@/lib/stammdaten/quantifier/service"
    );
    const created = createQuantifier({ name: "einige", value: null, aliases: [] });
    expect(created.value).toBeNull();
  });
});

describe("updateQuantifier", () => {
  it("changes value and adds/removes aliases", async () => {
    const { createQuantifier, updateQuantifier, getQuantifierDetail } =
      await import("@/lib/stammdaten/quantifier/service");
    const created = createQuantifier({
      name: "zwei",
      value: 2,
      aliases: ["zwo", "couple"],
    });
    const updated = updateQuantifier(created.id, {
      name: "zwei",
      value: 2.5,
      aliases: ["zwo", "duo"], // couple removed, duo added
    });
    expect(updated.value).toBe(2.5);
    expect(updated.aliases.sort()).toEqual(["duo", "zwo"]);

    const detail = getQuantifierDetail(created.id)!;
    expect(detail.aliases.sort()).toEqual(["duo", "zwo"]);
    expect(detail.aliases).not.toContain("couple");
  });
});

describe("deleteQuantifier delete-guard + replaceWith rewire", () => {
  it("reports recipeRefCount 1 when referenced and guards deletion", async () => {
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");
    const { createQuantifier, getQuantifierDetail, deleteQuantifier } =
      await import("@/lib/stammdaten/quantifier/service");

    const q = createQuantifier({ name: "drei", value: 3, aliases: [] });
    const sectionId = await makeSection();
    db.insert(recipeIngredient)
      .values({ sectionId, quantifierId: q.id })
      .run();

    expect(getQuantifierDetail(q.id)!.recipeRefCount).toBe(1);

    // Guard: refuse without replaceWith.
    expect(() => deleteQuantifier(q.id)).toThrow();
    // Still present.
    expect(getQuantifierDetail(q.id)).not.toBeNull();
  });

  it("rewires recipe_ingredient refs and deletes with replaceWith", async () => {
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { createQuantifier, getQuantifierDetail, deleteQuantifier } =
      await import("@/lib/stammdaten/quantifier/service");

    const loser = createQuantifier({ name: "drei", value: 3, aliases: [] });
    const winner = createQuantifier({ name: "vier", value: 4, aliases: [] });
    const sectionId = await makeSection();
    const ri = db
      .insert(recipeIngredient)
      .values({ sectionId, quantifierId: loser.id })
      .returning({ id: recipeIngredient.id })
      .all();

    deleteQuantifier(loser.id, winner.id);

    expect(getQuantifierDetail(loser.id)).toBeNull();
    const row = db
      .select({ quantifierId: recipeIngredient.quantifierId })
      .from(recipeIngredient)
      .where(eq(recipeIngredient.id, ri[0].id))
      .get();
    expect(row!.quantifierId).toBe(winner.id);
  });
});

describe("mergeQuantifiers", () => {
  it("rewires recipe_ingredient refs from loser to winner and removes loser", async () => {
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { createQuantifier, getQuantifierDetail, mergeQuantifiers } =
      await import("@/lib/stammdaten/quantifier/service");

    const winner = createQuantifier({ name: "ein paar", value: 3, aliases: [] });
    const loser = createQuantifier({ name: "paar", value: 3, aliases: [] });
    const sectionId = await makeSection();
    const ri = db
      .insert(recipeIngredient)
      .values({ sectionId, quantifierId: loser.id })
      .returning({ id: recipeIngredient.id })
      .all();

    mergeQuantifiers(winner.id, [loser.id]);

    expect(getQuantifierDetail(loser.id)).toBeNull();
    const row = db
      .select({ quantifierId: recipeIngredient.quantifierId })
      .from(recipeIngredient)
      .where(eq(recipeIngredient.id, ri[0].id))
      .get();
    expect(row!.quantifierId).toBe(winner.id);
    // Loser canonical name absorbed as winner alias.
    expect(getQuantifierDetail(winner.id)!.aliases).toContain("paar");
  });
});

describe("uniqueness collisions", () => {
  it("throws on a duplicate canonical name", async () => {
    const { createQuantifier } = await import(
      "@/lib/stammdaten/quantifier/service"
    );
    createQuantifier({ name: "zwei", value: 2, aliases: [] });
    expect(() =>
      createQuantifier({ name: "zwei", value: 2, aliases: [] }),
    ).toThrow();
  });

  it("throws when a new alias collides with an existing name", async () => {
    const { createQuantifier } = await import(
      "@/lib/stammdaten/quantifier/service"
    );
    createQuantifier({ name: "zwei", value: 2, aliases: [] });
    expect(() =>
      createQuantifier({ name: "drei", value: 3, aliases: ["zwei"] }),
    ).toThrow();
  });
});

describe("getImpactForQuantifiers", () => {
  it("returns linkedRecipes for a referenced quantifier", async () => {
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");
    const { createQuantifier, getImpactForQuantifiers } = await import(
      "@/lib/stammdaten/quantifier/service"
    );
    const q = createQuantifier({ name: "drei", value: 3, aliases: [] });
    const sectionId = await makeSection();
    db.insert(recipeIngredient).values({ sectionId, quantifierId: q.id }).run();

    const impact = getImpactForQuantifiers([q.id]);
    expect(impact).toHaveLength(1);
    expect(impact[0].linkedRecipes!.length).toBe(1);
  });
});
