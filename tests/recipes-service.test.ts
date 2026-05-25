import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-recipes-service-"));
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

type Ids = {
  tomatensuppe: number;
  spaghettiBolognese: number;
  apfelkuchen: number;
  unknownRecipe: number;
};

async function seed(): Promise<Ids> {
  const { db } = await import("@/db");
  const {
    ingredient,
    ingredientAlias,
    recipe,
    recipeIngredient,
    recipeSection,
    recipeTag,
    tag,
  } = await import("@/db/schema");

  db.delete(recipeTag).run();
  db.delete(recipeIngredient).run();
  db.delete(recipeSection).run();
  db.delete(recipe).run();
  db.delete(tag).run();
  db.delete(ingredientAlias).run();
  db.delete(ingredient).run();

  const tomate = db
    .insert(ingredient)
    .values({ name: "Tomate", dietaryClass: "vegan" })
    .returning({ id: ingredient.id })
    .all()[0].id;
  db.insert(ingredientAlias)
    .values({ ingredientId: tomate, name: "Strauchtomate" })
    .run();
  const basilikum = db
    .insert(ingredient)
    .values({ name: "Basilikum", dietaryClass: "vegan" })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const hack = db
    .insert(ingredient)
    .values({ name: "Hackfleisch", dietaryClass: "meat" })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const apfel = db
    .insert(ingredient)
    .values({ name: "Apfel", dietaryClass: "vegan" })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const butter = db
    .insert(ingredient)
    .values({ name: "Butter", dietaryClass: "vegetarian" })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const mystery = db
    .insert(ingredient)
    .values({ name: "Würzmischung", dietaryClass: null })
    .returning({ id: ingredient.id })
    .all()[0].id;

  function addRecipe(title: string, ingIds: number[]): number {
    const rid = db
      .insert(recipe)
      .values({ title, servings: 2 })
      .returning({ id: recipe.id })
      .all()[0].id;
    const sid = db
      .insert(recipeSection)
      .values({ recipeId: rid, instructions: "" })
      .returning({ id: recipeSection.id })
      .all()[0].id;
    ingIds.forEach((iid, idx) =>
      db
        .insert(recipeIngredient)
        .values({ sectionId: sid, ingredientId: iid, sortOrder: idx })
        .run(),
    );
    return rid;
  }

  const tomatensuppe = addRecipe("Tomatensuppe", [tomate, basilikum]);
  const spaghettiBolognese = addRecipe("Spaghetti Bolognese", [tomate, hack]);
  const apfelkuchen = addRecipe("Apfelkuchen", [apfel, butter]);
  const unknownRecipe = addRecipe("Mystery-Eintopf", [mystery]);

  const veggieTag = db
    .insert(tag)
    .values({ name: "Schnell" })
    .returning({ id: tag.id })
    .all()[0].id;
  db.insert(recipeTag).values({ recipeId: tomatensuppe, tagId: veggieTag }).run();

  return { tomatensuppe, spaghettiBolognese, apfelkuchen, unknownRecipe };
}

describe("listRecipes", () => {
  let ids: Ids;
  beforeAll(async () => {
    ids = await seed();
  });

  it("empty options returns every recipe, title-sorted", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    const out = listRecipes();
    expect(out.map((r) => r.title)).toEqual([
      "Apfelkuchen",
      "Mystery-Eintopf",
      "Spaghetti Bolognese",
      "Tomatensuppe",
    ]);
  });

  it("title token matches title fuzzily", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    expect(listRecipes({ query: "tomate" }).map((r) => r.id)).toContain(
      ids.tomatensuppe,
    );
  });

  it("zutat: matches canonical ingredient", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    expect(listRecipes({ query: "zutat:basilikum" }).map((r) => r.id)).toEqual([
      ids.tomatensuppe,
    ]);
  });

  it("zutat: matches an ingredient alias", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    expect(
      listRecipes({ query: "zutat:strauchtomate" })
        .map((r) => r.id)
        .sort(),
    ).toEqual([ids.spaghettiBolognese, ids.tomatensuppe].sort());
  });

  it("- excludes a token from the result", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    const out = listRecipes({
      query: "zutat:tomate -zutat:hackfleisch",
    }).map((r) => r.id);
    expect(out).toEqual([ids.tomatensuppe]);
  });

  it("diet=vegetarian keeps vegan + vegetarian, drops meat and unknown", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    const out = listRecipes({ diet: "vegetarian" })
      .map((r) => r.id)
      .sort();
    expect(out).toEqual([ids.apfelkuchen, ids.tomatensuppe].sort());
  });

  it("diet=vegan keeps only vegan tier", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    expect(listRecipes({ diet: "vegan" }).map((r) => r.id)).toEqual([
      ids.tomatensuppe,
    ]);
  });

  it("must-tags filter applies server-side", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    expect(listRecipes({ mustTags: ["Schnell"] }).map((r) => r.id)).toEqual([
      ids.tomatensuppe,
    ]);
  });

  it("combined query + diet + must-tags", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    const out = listRecipes({
      query: "tomate",
      diet: "vegan",
      mustTags: ["Schnell"],
    });
    expect(out.map((r) => r.id)).toEqual([ids.tomatensuppe]);
  });

  it("returns dietConfidence on every item", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    const byId = new Map(listRecipes().map((r) => [r.id, r]));
    expect(byId.get(ids.tomatensuppe)?.dietConfidence).toBe("definite");
    expect(byId.get(ids.unknownRecipe)?.dietConfidence).toBe("unknown");
  });
});
