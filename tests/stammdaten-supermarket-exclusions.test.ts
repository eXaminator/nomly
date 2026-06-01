import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-exclusions-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function loadModules() {
  const schema = await import("@/db/schema");
  const dbModule = await import("@/db");
  const ingredientService = await import("@/lib/stammdaten/ingredient/service");
  const supermarketService = await import(
    "@/lib/stammdaten/supermarket/service"
  );
  return { schema, db: dbModule.db, ingredientService, supermarketService };
}

async function resetDb() {
  const { db, schema } = await loadModules();
  db.delete(schema.ingredientSupermarketUnavailable).run();
  db.delete(schema.supermarketCategory).run();
  db.delete(schema.supermarket).run();
  db.delete(schema.ingredientAlias).run();
  db.delete(schema.ingredient).run();
}

type Ctx = {
  edekaId: number;
  reweId: number;
  tomateId: number;
  salzId: number;
};

async function seed(): Promise<Ctx> {
  await resetDb();
  const { db, schema, supermarketService } = await loadModules();
  const tomateId = db
    .insert(schema.ingredient)
    .values({ name: "Tomate" })
    .returning({ id: schema.ingredient.id })
    .all()[0].id;
  const salzId = db
    .insert(schema.ingredient)
    .values({ name: "Salz" })
    .returning({ id: schema.ingredient.id })
    .all()[0].id;
  const edeka = supermarketService.createSupermarket({
    name: "Edeka",
    orderedCategoryIds: [],
  });
  const rewe = supermarketService.createSupermarket({
    name: "Rewe",
    orderedCategoryIds: [],
  });
  return { edekaId: edeka.id, reweId: rewe.id, tomateId, salzId };
}

describe("ingredient ↔ supermarket exclusions", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  describe("ingredient side", () => {
    it("persists excluded supermarkets on create and reads them back", async () => {
      const { ingredientService } = await loadModules();
      const created = ingredientService.createIngredient({
        name: "Sojasauce",
        aliases: [],
        defaultCategoryId: null,
        excludeFromShoppingList: false,
        dietaryClass: null,
        excludedSupermarketIds: [ctx.edekaId, ctx.reweId],
      });
      expect(created.excludedSupermarkets.map((s) => s.id).sort()).toEqual(
        [ctx.edekaId, ctx.reweId].sort(),
      );
      expect(
        created.excludedSupermarkets.find((s) => s.id === ctx.edekaId)?.name,
      ).toBe("Edeka");
    });

    it("full-replaces excluded supermarkets on update", async () => {
      const { ingredientService } = await loadModules();
      ingredientService.updateIngredient(ctx.tomateId, {
        name: "Tomate",
        aliases: [],
        defaultCategoryId: null,
        excludeFromShoppingList: false,
        dietaryClass: null,
        excludedSupermarketIds: [ctx.edekaId, ctx.reweId],
      });
      const after = ingredientService.updateIngredient(ctx.tomateId, {
        name: "Tomate",
        aliases: [],
        defaultCategoryId: null,
        excludeFromShoppingList: false,
        dietaryClass: null,
        excludedSupermarketIds: [ctx.reweId],
      });
      expect(after.excludedSupermarkets.map((s) => s.id)).toEqual([ctx.reweId]);
    });

    it("rejects an unknown supermarket id", async () => {
      const { ingredientService } = await loadModules();
      expect(() =>
        ingredientService.updateIngredient(ctx.tomateId, {
          name: "Tomate",
          aliases: [],
          defaultCategoryId: null,
          excludeFromShoppingList: false,
          dietaryClass: null,
          excludedSupermarketIds: [999999],
        }),
      ).toThrow();
    });
  });

  describe("supermarket side", () => {
    it("persists unavailable articles on create and reads them back", async () => {
      const { supermarketService } = await loadModules();
      const created = supermarketService.createSupermarket({
        name: "Aldi",
        orderedCategoryIds: [],
        unavailableIngredientIds: [ctx.tomateId, ctx.salzId],
      });
      const detail = supermarketService.getSupermarketDetail(created.id)!;
      expect(detail.unavailableArticles.map((a) => a.id).sort()).toEqual(
        [ctx.tomateId, ctx.salzId].sort(),
      );
      expect(
        detail.unavailableArticles.find((a) => a.id === ctx.tomateId)?.name,
      ).toBe("Tomate");
    });

    it("full-replaces unavailable articles on update", async () => {
      const { supermarketService } = await loadModules();
      supermarketService.updateSupermarket(ctx.edekaId, {
        name: "Edeka",
        orderedCategoryIds: [],
        unavailableIngredientIds: [ctx.tomateId, ctx.salzId],
      });
      supermarketService.updateSupermarket(ctx.edekaId, {
        name: "Edeka",
        orderedCategoryIds: [],
        unavailableIngredientIds: [ctx.salzId],
      });
      const detail = supermarketService.getSupermarketDetail(ctx.edekaId)!;
      expect(detail.unavailableArticles.map((a) => a.id)).toEqual([ctx.salzId]);
    });

    it("rejects an unknown ingredient id", async () => {
      const { supermarketService } = await loadModules();
      expect(() =>
        supermarketService.updateSupermarket(ctx.edekaId, {
          name: "Edeka",
          orderedCategoryIds: [],
          unavailableIngredientIds: [999999],
        }),
      ).toThrow();
    });
  });

  describe("bulk add / remove excluded supermarkets", () => {
    it("adds a supermarket to the exclusions of every selected article", async () => {
      const { ingredientService } = await loadModules();
      ingredientService.bulkUpdateIngredients([ctx.tomateId, ctx.salzId], {
        addExcludedSupermarketIds: [ctx.edekaId],
      });
      const tomate = ingredientService.getIngredientDetail(ctx.tomateId)!;
      const salz = ingredientService.getIngredientDetail(ctx.salzId)!;
      expect(tomate.excludedSupermarkets.map((s) => s.id)).toEqual([ctx.edekaId]);
      expect(salz.excludedSupermarkets.map((s) => s.id)).toEqual([ctx.edekaId]);
    });

    it("is non-destructive and de-dupes existing exclusions", async () => {
      const { ingredientService } = await loadModules();
      // Tomate already excluded from Rewe.
      ingredientService.updateIngredient(ctx.tomateId, {
        name: "Tomate",
        aliases: [],
        defaultCategoryId: null,
        excludeFromShoppingList: false,
        dietaryClass: null,
        excludedSupermarketIds: [ctx.reweId],
      });
      // Bulk-add Edeka (and Rewe again — must not duplicate).
      ingredientService.bulkUpdateIngredients([ctx.tomateId], {
        addExcludedSupermarketIds: [ctx.edekaId, ctx.reweId],
      });
      const tomate = ingredientService.getIngredientDetail(ctx.tomateId)!;
      expect(tomate.excludedSupermarkets.map((s) => s.id).sort()).toEqual(
        [ctx.edekaId, ctx.reweId].sort(),
      );
    });

    it("removes a supermarket from the exclusions of every selected article", async () => {
      const { ingredientService } = await loadModules();
      ingredientService.bulkUpdateIngredients([ctx.tomateId, ctx.salzId], {
        addExcludedSupermarketIds: [ctx.edekaId, ctx.reweId],
      });
      ingredientService.bulkUpdateIngredients([ctx.tomateId, ctx.salzId], {
        removeExcludedSupermarketIds: [ctx.edekaId],
      });
      const tomate = ingredientService.getIngredientDetail(ctx.tomateId)!;
      expect(tomate.excludedSupermarkets.map((s) => s.id)).toEqual([ctx.reweId]);
    });

    it("applies add and remove together in one call", async () => {
      const { ingredientService } = await loadModules();
      ingredientService.updateIngredient(ctx.tomateId, {
        name: "Tomate",
        aliases: [],
        defaultCategoryId: null,
        excludeFromShoppingList: false,
        dietaryClass: null,
        excludedSupermarketIds: [ctx.edekaId],
      });
      ingredientService.bulkUpdateIngredients([ctx.tomateId], {
        addExcludedSupermarketIds: [ctx.reweId],
        removeExcludedSupermarketIds: [ctx.edekaId],
      });
      const tomate = ingredientService.getIngredientDetail(ctx.tomateId)!;
      expect(tomate.excludedSupermarkets.map((s) => s.id)).toEqual([ctx.reweId]);
    });

    it("rejects an unknown supermarket id", async () => {
      const { ingredientService } = await loadModules();
      expect(() =>
        ingredientService.bulkUpdateIngredients([ctx.tomateId], {
          addExcludedSupermarketIds: [999999],
        }),
      ).toThrow();
    });
  });

  it("both sides observe the same join rows", async () => {
    const { ingredientService, supermarketService } = await loadModules();
    // Exclude Tomate from Edeka via the ingredient side …
    ingredientService.updateIngredient(ctx.tomateId, {
      name: "Tomate",
      aliases: [],
      defaultCategoryId: null,
      excludeFromShoppingList: false,
      dietaryClass: null,
      excludedSupermarketIds: [ctx.edekaId],
    });
    // … and it shows up on the supermarket side.
    const edeka = supermarketService.getSupermarketDetail(ctx.edekaId)!;
    expect(edeka.unavailableArticles.map((a) => a.id)).toEqual([ctx.tomateId]);
  });
});
