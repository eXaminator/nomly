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

describe("createRecipe + getRecipe with alternatives", () => {
  beforeAll(async () => {
    await seed();
  });

  async function createWithAlternatives() {
    const { createRecipe } = await import("@/lib/recipes/service");
    return createRecipe({
      title: "Bohnen-Brownies",
      description: null,
      servings: 4,
      prepTimeMin: null,
      cookTimeMin: null,
      sourceUrl: null,
      photoPath: null,
      tags: [],
      sections: [
        {
          title: null,
          instructions: "",
          ingredients: [
            {
              ingredientName: "Tahin",
              ingredientId: null,
              quantity: 1,
              unitId: null,
              subUnitId: null,
              displayUnit: null,
              notes: null,
              isOptional: false,
              fixedAmount: false,
              isAlternative: false,
            },
            {
              ingredientName: "Mandelmus",
              ingredientId: null,
              quantity: 1,
              unitId: null,
              subUnitId: null,
              displayUnit: null,
              notes: null,
              isOptional: true,
              fixedAmount: false,
              isAlternative: true,
            },
            {
              ingredientName: "Sesammus",
              ingredientId: null,
              quantity: 1,
              unitId: null,
              subUnitId: null,
              displayUnit: null,
              notes: null,
              isOptional: true,
              fixedAmount: false,
              isAlternative: true,
            },
          ],
        },
      ],
    });
  }

  it("links each alternative row to the most recent primary in the same section", async () => {
    const id = await createWithAlternatives();
    const { getRecipe } = await import("@/lib/recipes/service");
    const r = getRecipe(id);
    expect(r).not.toBeNull();
    const ingredients = r!.sections[0].ingredients;
    expect(ingredients.map((i) => i.ingredientName)).toEqual([
      "Tahin",
      "Mandelmus",
      "Sesammus",
    ]);
    // Primary has no alternativeForId.
    expect(ingredients[0].alternativeForId).toBeNull();
    // Both alternatives point at the same primary id.
    expect(ingredients[1].alternativeForId).toBe(ingredients[0].id);
    expect(ingredients[2].alternativeForId).toBe(ingredients[0].id);
  });

  it("force-marks alternative rows isOptional=true even when the input claims otherwise", async () => {
    const { createRecipe, getRecipe } = await import("@/lib/recipes/service");
    const id = createRecipe({
      title: "Forced-optional alternative",
      description: null,
      servings: 1,
      prepTimeMin: null,
      cookTimeMin: null,
      sourceUrl: null,
      photoPath: null,
      tags: [],
      sections: [
        {
          title: null,
          instructions: "",
          ingredients: [
            {
              ingredientName: "Reis",
              ingredientId: null,
              quantity: 300,
              unitId: null,
              subUnitId: null,
              displayUnit: null,
              notes: null,
              isOptional: false,
              fixedAmount: false,
              isAlternative: false,
            },
            {
              ingredientName: "Naan-Brot",
              ingredientId: null,
              quantity: 1,
              unitId: null,
              subUnitId: null,
              displayUnit: null,
              notes: null,
              isOptional: false, // input lies
              fixedAmount: false,
              isAlternative: true,
            },
          ],
        },
      ],
    });
    const r = getRecipe(id);
    const alt = r!.sections[0].ingredients[1];
    expect(alt.ingredientName).toBe("Naan-Brot");
    expect(alt.isOptional).toBe(true);
  });

  it("survives an updateRecipe round-trip without losing the alternative linkage", async () => {
    const id = await createWithAlternatives();
    const { getRecipe, updateRecipe } = await import("@/lib/recipes/service");
    const before = getRecipe(id)!;
    updateRecipe(id, {
      title: before.title,
      description: before.description,
      servings: before.servings,
      prepTimeMin: before.prepTimeMin,
      cookTimeMin: before.cookTimeMin,
      sourceUrl: before.sourceUrl,
      photoPath: before.photoPath,
      tags: before.tags,
      sections: before.sections.map((s) => ({
        title: s.title,
        instructions: s.instructions,
        ingredients: s.ingredients.map((i) => ({
          ingredientName: i.ingredientName,
          ingredientId: i.ingredientId,
          quantity: i.quantity,
          unitId: i.unitId,
          subUnitId: i.subUnitId,
          displayUnit: null,
          notes: i.notes,
          isOptional: i.isOptional,
          fixedAmount: i.fixedAmount,
          isAlternative: i.alternativeForId != null,
        })),
      })),
    });
    const after = getRecipe(id)!;
    const ings = after.sections[0].ingredients;
    expect(ings.map((i) => i.ingredientName)).toEqual([
      "Tahin",
      "Mandelmus",
      "Sesammus",
    ]);
    expect(ings[0].alternativeForId).toBeNull();
    expect(ings[1].alternativeForId).toBe(ings[0].id);
    expect(ings[2].alternativeForId).toBe(ings[0].id);
  });

  it("persists an unassigned line as ingredient_id NULL without creating an article", async () => {
    const { db } = await import("@/db");
    const { ingredient } = await import("@/db/schema");
    const { createRecipe, getRecipe } = await import("@/lib/recipes/service");
    const before = db.select().from(ingredient).all().length;
    const id = createRecipe({
      title: "Gazpacho mit Resten",
      description: null,
      servings: 4,
      prepTimeMin: null,
      cookTimeMin: null,
      sourceUrl: null,
      photoPath: null,
      tags: [],
      sections: [
        {
          title: null,
          instructions: "",
          ingredients: [
            {
              ingredientName: "übrige gehackte Gazpacho-Zutaten",
              ingredientId: null,
              unassigned: true,
              quantity: 2,
              unitId: null,
              subUnitId: null,
              displayUnit: null,
              notes: "zum Garnieren",
              isOptional: false,
              fixedAmount: false,
              isAlternative: false,
            },
          ],
        },
      ],
    });
    // No new article row was created for the free-text line.
    expect(db.select().from(ingredient).all().length).toBe(before);
    const r = getRecipe(id)!;
    const line = r.sections[0].ingredients[0];
    expect(line.ingredientId).toBeNull();
    expect(line.canonicalIngredientName).toBeNull();
    expect(line.ingredientName).toBe("übrige gehackte Gazpacho-Zutaten");
    expect(line.quantity).toBe(2);
    expect(line.notes).toBe("zum Garnieren");
  });

  it("preserves an unassigned line across an updateRecipe round-trip", async () => {
    const { createRecipe, getRecipe, updateRecipe } = await import(
      "@/lib/recipes/service"
    );
    const id = createRecipe({
      title: "Round-trip Reste",
      description: null,
      servings: 2,
      prepTimeMin: null,
      cookTimeMin: null,
      sourceUrl: null,
      photoPath: null,
      tags: [],
      sections: [
        {
          title: null,
          instructions: "",
          ingredients: [
            {
              ingredientName: "Reste vom Vortag",
              ingredientId: null,
              unassigned: true,
              quantity: null,
              unitId: null,
              subUnitId: null,
              displayUnit: null,
              notes: null,
              isOptional: false,
              fixedAmount: false,
              isAlternative: false,
            },
          ],
        },
      ],
    });
    const before = getRecipe(id)!;
    updateRecipe(id, {
      title: before.title,
      description: before.description,
      servings: before.servings,
      prepTimeMin: before.prepTimeMin,
      cookTimeMin: before.cookTimeMin,
      sourceUrl: before.sourceUrl,
      photoPath: before.photoPath,
      tags: before.tags,
      sections: before.sections.map((s) => ({
        title: s.title,
        instructions: s.instructions,
        ingredients: s.ingredients.map((i) => ({
          ingredientName: i.ingredientName,
          ingredientId: i.ingredientId,
          unassigned: i.ingredientId == null,
          quantity: i.quantity,
          unitId: i.unitId,
          subUnitId: i.subUnitId,
          displayUnit: null,
          notes: i.notes,
          isOptional: i.isOptional,
          fixedAmount: i.fixedAmount,
          isAlternative: i.alternativeForId != null,
        })),
      })),
    });
    const after = getRecipe(id)!;
    expect(after.sections[0].ingredients[0].ingredientId).toBeNull();
    expect(after.sections[0].ingredients[0].ingredientName).toBe(
      "Reste vom Vortag",
    );
  });

  it("ignores unassigned lines when deriving the recipe diet", async () => {
    const { db } = await import("@/db");
    const { ingredient } = await import("@/db/schema");
    const { createRecipe, getRecipe } = await import("@/lib/recipes/service");
    const veganId = db
      .insert(ingredient)
      .values({ name: "Gurke", dietaryClass: "vegan" })
      .returning({ id: ingredient.id })
      .all()[0].id;
    const id = createRecipe({
      title: "Diet mit Reste",
      description: null,
      servings: 2,
      prepTimeMin: null,
      cookTimeMin: null,
      sourceUrl: null,
      photoPath: null,
      tags: [],
      sections: [
        {
          title: null,
          instructions: "",
          ingredients: [
            {
              ingredientName: "Gurke",
              ingredientId: veganId,
              quantity: 1,
              unitId: null,
              subUnitId: null,
              displayUnit: null,
              notes: null,
              isOptional: false,
              fixedAmount: false,
              isAlternative: false,
            },
            {
              ingredientName: "übrige Reste",
              ingredientId: null,
              unassigned: true,
              quantity: null,
              unitId: null,
              subUnitId: null,
              displayUnit: null,
              notes: null,
              isOptional: false,
              fixedAmount: false,
              isAlternative: false,
            },
          ],
        },
      ],
    });
    const r = getRecipe(id)!;
    // The unassigned line (unknown dietary class) must not drag the recipe
    // down to "probably vegan" — only the real vegan ingredient counts.
    expect(r.isVegan).toBe(true);
    expect(r.dietConfidence).toBe("definite");
  });

  it("an alternative with no preceding primary in the section is promoted to primary instead", async () => {
    const { createRecipe, getRecipe } = await import("@/lib/recipes/service");
    const id = createRecipe({
      title: "Orphan alternative",
      description: null,
      servings: 1,
      prepTimeMin: null,
      cookTimeMin: null,
      sourceUrl: null,
      photoPath: null,
      tags: [],
      sections: [
        {
          title: null,
          instructions: "",
          ingredients: [
            {
              ingredientName: "Orphan",
              ingredientId: null,
              quantity: 1,
              unitId: null,
              subUnitId: null,
              displayUnit: null,
              notes: null,
              isOptional: true,
              fixedAmount: false,
              isAlternative: true,
            },
          ],
        },
      ],
    });
    const r = getRecipe(id);
    expect(r!.sections[0].ingredients[0].alternativeForId).toBeNull();
  });
});

describe("needsUpdate flag + filter", () => {
  let ids: Ids;
  beforeAll(async () => {
    ids = await seed();
  });

  it("defaults to false and round-trips through getRecipe", async () => {
    const { getRecipe } = await import("@/lib/recipes/service");
    expect(getRecipe(ids.tomatensuppe)!.needsUpdate).toBe(false);
  });

  it("setRecipeNeedsUpdate flips the flag; listRecipes exposes it", async () => {
    const { setRecipeNeedsUpdate, getRecipe, listRecipes } = await import(
      "@/lib/recipes/service"
    );
    expect(setRecipeNeedsUpdate(ids.spaghettiBolognese, true)).toBe(true);
    expect(getRecipe(ids.spaghettiBolognese)!.needsUpdate).toBe(true);
    const byId = new Map(listRecipes().map((r) => [r.id, r]));
    expect(byId.get(ids.spaghettiBolognese)?.needsUpdate).toBe(true);
    expect(byId.get(ids.tomatensuppe)?.needsUpdate).toBe(false);
  });

  it("setRecipeNeedsUpdate returns false for a missing recipe", async () => {
    const { setRecipeNeedsUpdate } = await import("@/lib/recipes/service");
    expect(setRecipeNeedsUpdate(999_999, true)).toBe(false);
  });

  it("needsUpdate filter keeps only flagged recipes", async () => {
    const { setRecipeNeedsUpdate, listRecipes } = await import(
      "@/lib/recipes/service"
    );
    setRecipeNeedsUpdate(ids.spaghettiBolognese, true);
    setRecipeNeedsUpdate(ids.apfelkuchen, true);
    const out = listRecipes({ needsUpdate: true })
      .map((r) => r.id)
      .sort();
    expect(out).toEqual([ids.spaghettiBolognese, ids.apfelkuchen].sort());
  });

  it("needsUpdate filter composes with other filters", async () => {
    const { setRecipeNeedsUpdate, listRecipes } = await import(
      "@/lib/recipes/service"
    );
    setRecipeNeedsUpdate(ids.tomatensuppe, true);
    setRecipeNeedsUpdate(ids.spaghettiBolognese, true);
    // Only the flagged AND vegan one survives.
    const out = listRecipes({ needsUpdate: true, diet: "vegan" }).map(
      (r) => r.id,
    );
    expect(out).toEqual([ids.tomatensuppe]);
  });
});
