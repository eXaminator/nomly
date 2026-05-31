import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-stammdaten-ing-"));
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

async function loadModules() {
  const schema = await import("@/db/schema");
  const dbModule = await import("@/db");
  const service = await import("@/lib/stammdaten/ingredient/service");
  return { schema, db: dbModule.db, service };
}

async function resetDb() {
  const { db, schema } = await loadModules();
  // Order matters: child tables first.
  db.delete(schema.shoppingItemSource).run();
  db.delete(schema.shoppingItem).run();
  db.delete(schema.recipeTag).run();
  db.delete(schema.recipeIngredient).run();
  db.delete(schema.recipeSection).run();
  db.delete(schema.recipe).run();
  db.delete(schema.ingredientAlias).run();
  db.delete(schema.ingredient).run();
  db.delete(schema.unitAlias).run();
  db.delete(schema.unit).run();
  db.delete(schema.categoryAlias).run();
  db.delete(schema.category).run();
  db.delete(schema.tag).run();
}

async function seedRecipeUsing(ingredientId: number, unitId: number) {
  const { db, schema } = await loadModules();
  const recipeId = db
    .insert(schema.recipe)
    .values({ title: "Test-Rezept", servings: 1 })
    .returning({ id: schema.recipe.id })
    .all()[0].id;
  const sectionId = db
    .insert(schema.recipeSection)
    .values({ recipeId, instructions: "" })
    .returning({ id: schema.recipeSection.id })
    .all()[0].id;
  db.insert(schema.recipeIngredient)
    .values({
      sectionId,
      ingredientId,
      unitId,
      quantity: 1,
    })
    .run();
  return recipeId;
}

async function seedUnit(name = "Gramm", dimension: "mass" | "volume" | "count" = "mass") {
  const { db, schema } = await loadModules();
  return db
    .insert(schema.unit)
    .values({ name, dimension, factor: 1 })
    .returning({ id: schema.unit.id })
    .all()[0].id;
}

describe("ingredient stammdaten service", () => {
  beforeAll(async () => {
    await resetDb();
  });

  describe("create + update + alias uniqueness", () => {
    it("creates a row with aliases, list returns it", async () => {
      const { service } = await loadModules();
      const created = service.createIngredient({
        name: "Tomate",
        aliases: ["Tomaten", "Strauchtomate"],
        defaultCategoryId: null,
        excludeFromShoppingList: false,
        dietaryClass: "vegan",
      });
      expect(created.name).toBe("Tomate");
      expect(created.aliases.sort()).toEqual(["Strauchtomate", "Tomaten"]);
      expect(created.dietaryClass).toBe("vegan");

      const list = service.listIngredients();
      expect(list.find((r) => r.id === created.id)?.name).toBe("Tomate");
    });

    it("rejects duplicate canonical name (case-insensitive)", async () => {
      const { service } = await loadModules();
      expect(() =>
        service.createIngredient({
          name: "tomate",
          aliases: [],
          defaultCategoryId: null,
          excludeFromShoppingList: false,
          dietaryClass: null,
        }),
      ).toThrow(/bereits vergeben/);
    });

    it("rejects alias matching an existing canonical name", async () => {
      const { service } = await loadModules();
      expect(() =>
        service.createIngredient({
          name: "Cherrytomate",
          aliases: ["Tomate"],
          defaultCategoryId: null,
          excludeFromShoppingList: false,
          dietaryClass: null,
        }),
      ).toThrow(/bereits vergeben/);
    });

    it("persists a canonical-name default sub-unit and reads it back", async () => {
      const { service } = await loadModules();
      const created = service.createIngredient({
        name: "Gemüsestäbchen",
        aliases: [],
        subUnits: [{ name: "Stäbchen" }],
        // Index 0 → the "Stäbchen" sub-unit written above.
        defaultSubUnitIndex: 0,
        defaultCategoryId: null,
        excludeFromShoppingList: false,
        dietaryClass: "vegan",
      });
      const subUnitId = created.subUnits.find((s) => s.name === "Stäbchen")!.id;
      expect(created.defaultSubUnitId).toBe(subUnitId);
      expect(created.defaultUnitId).toBeNull();

      const detail = service.getIngredientDetail(created.id)!;
      expect(detail.defaultSubUnitId).toBe(subUnitId);
    });

    it("update can swap aliases and rename", async () => {
      const { service } = await loadModules();
      const id = service.listIngredients().find((r) => r.name === "Tomate")!.id;
      const updated = service.updateIngredient(id, {
        name: "Tomate (reif)",
        aliases: ["Tomate", "Salattomate"],
        defaultCategoryId: null,
        excludeFromShoppingList: true,
        dietaryClass: "vegetarian",
      });
      expect(updated.name).toBe("Tomate (reif)");
      expect(updated.aliases.sort()).toEqual(["Salattomate", "Tomate"]);
      expect(updated.excludeFromShoppingList).toBe(true);
      expect(updated.dietaryClass).toBe("vegetarian");
    });
  });

  describe("merge", () => {
    it("absorbs losers + their aliases into winner aliases and rewires recipe_ingredient refs", async () => {
      await resetDb();
      const { db, schema, service } = await loadModules();

      const winner = service.createIngredient({
        name: "Tomate",
        aliases: ["Tomaten"],
        defaultCategoryId: null,
        excludeFromShoppingList: false,
        dietaryClass: "vegan",
      });
      const loserA = service.createIngredient({
        name: "Strauchtomate",
        aliases: ["Strauch-Tomate"],
        defaultCategoryId: null,
        excludeFromShoppingList: false,
        dietaryClass: null,
      });
      const loserB = service.createIngredient({
        name: "Cherrytomate",
        aliases: [],
        defaultCategoryId: null,
        excludeFromShoppingList: false,
        dietaryClass: null,
      });

      const unitId = await seedUnit();
      const recipeIdA = await seedRecipeUsing(loserA.id, unitId);
      const recipeIdB = await seedRecipeUsing(loserB.id, unitId);

      const result = service.mergeIngredients(winner.id, [loserA.id, loserB.id]);
      expect(result.deletedIds.sort()).toEqual([loserA.id, loserB.id].sort());

      // Aliases absorbed
      const after = service.getIngredientDetail(winner.id)!;
      const aliasSet = new Set(after.aliases.map((a) => a.toLowerCase()));
      expect(aliasSet.has("tomaten")).toBe(true);
      expect(aliasSet.has("strauchtomate")).toBe(true);
      expect(aliasSet.has("strauch-tomate")).toBe(true);
      expect(aliasSet.has("cherrytomate")).toBe(true);
      // Canonical name unchanged
      expect(aliasSet.has("tomate")).toBe(false);

      // Losers removed
      expect(service.getIngredientDetail(loserA.id)).toBe(null);
      expect(service.getIngredientDetail(loserB.id)).toBe(null);

      // recipe_ingredient refs rewired to winner
      const allRecipeIngredients = db
        .select()
        .from(schema.recipeIngredient)
        .all();
      for (const ri of allRecipeIngredients) {
        expect(ri.ingredientId).toBe(winner.id);
      }
      expect([recipeIdA, recipeIdB]).toHaveLength(2);
    });

    it("refuses merge when winner is also in losers", async () => {
      const { service } = await loadModules();
      const w = service.listIngredients()[0];
      expect(() => service.mergeIngredients(w.id, [w.id])).toThrow();
    });
  });

  describe("delete", () => {
    beforeAll(async () => {
      await resetDb();
    });

    it("plain delete succeeds when no refs", async () => {
      const { service } = await loadModules();
      const created = service.createIngredient({
        name: "Einzelgänger",
        aliases: [],
        defaultCategoryId: null,
        excludeFromShoppingList: false,
        dietaryClass: null,
      });
      const result = service.deleteIngredient(created.id);
      expect(result.deletedId).toBe(created.id);
      expect(service.getIngredientDetail(created.id)).toBe(null);
    });

    it("plain delete is refused when recipe refs exist", async () => {
      const { service } = await loadModules();
      const ing = service.createIngredient({
        name: "Schalotte",
        aliases: [],
        defaultCategoryId: null,
        excludeFromShoppingList: false,
        dietaryClass: null,
      });
      const unitId = await seedUnit("Stück", "count");
      await seedRecipeUsing(ing.id, unitId);
      expect(() => service.deleteIngredient(ing.id)).toThrow(
        /Ersatz-Zutat/,
      );
    });

    it("delete-with-replacement rewires refs", async () => {
      const { db, schema, service } = await loadModules();
      const replacement = service.createIngredient({
        name: "Zwiebel",
        aliases: [],
        defaultCategoryId: null,
        excludeFromShoppingList: false,
        dietaryClass: null,
      });
      const toDelete = service
        .listIngredients()
        .find((r) => r.name === "Schalotte")!;
      service.deleteIngredient(toDelete.id, replacement.id);
      expect(service.getIngredientDetail(toDelete.id)).toBe(null);
      // The replacement should now own the recipe_ingredient row + receive
      // the deleted name as an alias.
      const all = db.select().from(schema.recipeIngredient).all();
      for (const ri of all) {
        expect(ri.ingredientId).toBe(replacement.id);
      }
      const detail = service.getIngredientDetail(replacement.id)!;
      expect(detail.aliases.map((a) => a.toLowerCase())).toContain(
        "schalotte",
      );
    });
  });
});
