import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-stammdaten-merge-"));
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

async function load() {
  return {
    db: (await import("@/db")).db,
    schema: await import("@/db/schema"),
    product: await import("@/lib/stammdaten/product/service"),
    unit: await import("@/lib/stammdaten/unit/service"),
    category: await import("@/lib/stammdaten/category/service"),
    tag: await import("@/lib/stammdaten/tag/service"),
    supermarket: await import("@/lib/stammdaten/supermarket/service"),
  };
}

async function reset() {
  const { db, schema } = await load();
  db.delete(schema.shoppingItemSource).run();
  db.delete(schema.shoppingItem).run();
  db.delete(schema.recipeTag).run();
  db.delete(schema.recipeIngredient).run();
  db.delete(schema.recipeSection).run();
  db.delete(schema.recipe).run();
  db.delete(schema.productAlias).run();
  db.delete(schema.product).run();
  db.delete(schema.unitAlias).run();
  db.delete(schema.unit).run();
  db.delete(schema.supermarketCategory).run();
  db.delete(schema.supermarket).run();
  db.delete(schema.categoryAlias).run();
  db.delete(schema.category).run();
  db.delete(schema.tag).run();
}

describe("unit stammdaten merge", () => {
  beforeAll(async () => reset());

  it("refuses merge when dimensions differ", async () => {
    const { unit } = await load();
    const gram = unit.createUnit({
      name: "Gramm",
      aliases: [],
      dimension: "mass",
      baseUnitId: null,
      factor: 1,
    });
    const ml = unit.createUnit({
      name: "Milliliter",
      aliases: [],
      dimension: "volume",
      baseUnitId: null,
      factor: 1,
    });
    expect(() => unit.mergeUnits(gram.id, [ml.id])).toThrow(/Dimension/);
  });

  it("refuses merge when factors differ", async () => {
    const { unit } = await load();
    const kg = unit.createUnit({
      name: "Kilogramm",
      aliases: [],
      dimension: "mass",
      baseUnitId: null,
      factor: 1000,
    });
    const g = unit.listUnitsManaged().find((u) => u.name === "Gramm")!;
    expect(() => unit.mergeUnits(g.id, [kg.id])).toThrow(/Faktor/);
  });

  it("merges aliases when dimension+factor match", async () => {
    const { unit } = await load();
    const stk = unit.createUnit({
      name: "Stück",
      aliases: ["Stk"],
      dimension: "count",
      baseUnitId: null,
      factor: 1,
    });
    const piece = unit.createUnit({
      name: "Piece",
      aliases: ["Pcs"],
      dimension: "count",
      baseUnitId: null,
      factor: 1,
    });
    const result = unit.mergeUnits(stk.id, [piece.id]);
    expect(result.deletedIds).toEqual([piece.id]);
    const after = unit.getUnitDetail(stk.id)!;
    const aliasSet = new Set(after.aliases.map((a) => a.toLowerCase()));
    expect(aliasSet.has("piece")).toBe(true);
    expect(aliasSet.has("pcs")).toBe(true);
    expect(aliasSet.has("stk")).toBe(true);
  });
});

describe("product stammdaten merge", () => {
  beforeAll(async () => reset());

  it("absorbs aliases and rewires shopping_item refs", async () => {
    const { db, schema, product } = await load();

    const winner = product.createProduct({
      name: "Toilettenpapier",
      aliases: ["Klopapier"],
      defaultCategoryId: null,
    });
    const loser = product.createProduct({
      name: "Klopapierrolle",
      aliases: ["TP-Rolle"],
      defaultCategoryId: null,
    });
    // Insert a shopping_item referring to the loser product.
    db.insert(schema.shoppingItem)
      .values({ productId: loser.id })
      .run();

    product.mergeProducts(winner.id, [loser.id]);

    const after = product.getProductDetail(winner.id)!;
    const aliasSet = new Set(after.aliases.map((a) => a.toLowerCase()));
    expect(aliasSet.has("klopapierrolle")).toBe(true);
    expect(aliasSet.has("tp-rolle")).toBe(true);
    expect(product.getProductDetail(loser.id)).toBe(null);

    const items = db.select().from(schema.shoppingItem).all();
    for (const item of items) {
      expect(item.productId).toBe(winner.id);
    }
  });
});

describe("tag stammdaten merge", () => {
  beforeAll(async () => reset());

  it("dedupes recipe_tag rows when winner already tags a recipe", async () => {
    const { db, schema, tag } = await load();

    const winnerTag = tag.createTag({ name: "Schnell" });
    const loserTag = tag.createTag({ name: "Quick" });
    const otherTag = tag.createTag({ name: "Vegetarisch" });
    void otherTag;

    // Recipe 1: both winner + loser
    const recipe1 = db
      .insert(schema.recipe)
      .values({ title: "Salat", servings: 1 })
      .returning({ id: schema.recipe.id })
      .all()[0].id;
    db.insert(schema.recipeTag)
      .values([
        { recipeId: recipe1, tagId: winnerTag.id },
        { recipeId: recipe1, tagId: loserTag.id },
      ])
      .run();
    // Recipe 2: only loser
    const recipe2 = db
      .insert(schema.recipe)
      .values({ title: "Suppe", servings: 1 })
      .returning({ id: schema.recipe.id })
      .all()[0].id;
    db.insert(schema.recipeTag)
      .values({ recipeId: recipe2, tagId: loserTag.id })
      .run();

    tag.mergeTags(winnerTag.id, [loserTag.id]);

    const remaining = db.select().from(schema.recipeTag).all();
    expect(remaining).toHaveLength(2);
    for (const rt of remaining) {
      expect(rt.tagId).toBe(winnerTag.id);
    }
    const recipeIds = new Set(remaining.map((rt) => rt.recipeId));
    expect(recipeIds.has(recipe1)).toBe(true);
    expect(recipeIds.has(recipe2)).toBe(true);
    expect(tag.getTagDetail(loserTag.id)).toBe(null);
  });
});

describe("category stammdaten merge", () => {
  beforeAll(async () => reset());

  it("dedupes supermarket_category when both winner and loser appear in same supermarket", async () => {
    const { db, schema, category, supermarket } = await load();

    const winnerCat = category.createCategory({ name: "Gemüse", aliases: [] });
    const loserCat = category.createCategory({ name: "Veg", aliases: [] });
    const otherCat = category.createCategory({ name: "Obst", aliases: [] });

    // Supermarket A: has winner only
    const sma = supermarket.createSupermarket({
      name: "Edeka",
      orderedCategoryIds: [winnerCat.id, otherCat.id],
    });
    // Supermarket B: has both winner AND loser
    const smb = supermarket.createSupermarket({
      name: "Rewe",
      orderedCategoryIds: [winnerCat.id, loserCat.id],
    });
    // Supermarket C: has loser only
    const smc = supermarket.createSupermarket({
      name: "Lidl",
      orderedCategoryIds: [loserCat.id],
    });

    category.mergeCategories(winnerCat.id, [loserCat.id]);

    // sma: 2 rows, winnerCat + otherCat (unchanged)
    // smb: originally winnerCat + loserCat; loser deduped → just winnerCat
    // smc: 1 row, winnerCat (rewired from loser)
    void db;
    void schema;

    const aDetail = supermarket.getSupermarketDetail(sma.id)!;
    expect(aDetail.orderedCategories.map((c) => c.categoryId).sort()).toEqual(
      [winnerCat.id, otherCat.id].sort(),
    );

    const bDetail = supermarket.getSupermarketDetail(smb.id)!;
    // winner kept, loser deduped → just winner
    expect(bDetail.orderedCategories.map((c) => c.categoryId)).toEqual([
      winnerCat.id,
    ]);

    const cDetail = supermarket.getSupermarketDetail(smc.id)!;
    // loser rewired to winner
    expect(cDetail.orderedCategories.map((c) => c.categoryId)).toEqual([
      winnerCat.id,
    ]);

    expect(category.getCategoryDetail(loserCat.id)).toBe(null);
  });
});

describe("supermarket stammdaten merge", () => {
  beforeAll(async () => reset());

  it("dedupes supermarket_category when winner and loser both order the same category", async () => {
    const { supermarket, category } = await load();

    const cat1 = category.createCategory({ name: "Backwaren", aliases: [] });
    const cat2 = category.createCategory({ name: "Tiefkühl", aliases: [] });
    const cat3 = category.createCategory({ name: "Getränke", aliases: [] });

    // Winner has cat1 + cat2
    const winner = supermarket.createSupermarket({
      name: "Hauptmarkt",
      orderedCategoryIds: [cat1.id, cat2.id],
    });
    // Loser has cat1 (conflicts with winner) + cat3 (rewires to winner)
    const loser = supermarket.createSupermarket({
      name: "Außenstelle",
      orderedCategoryIds: [cat1.id, cat3.id],
    });

    supermarket.mergeSupermarkets(winner.id, [loser.id]);

    const detail = supermarket.getSupermarketDetail(winner.id)!;
    const catIds = detail.orderedCategories.map((c) => c.categoryId).sort();
    // Should have: cat1 (kept from winner), cat2 (kept from winner), cat3 (rewired from loser)
    expect(catIds).toEqual([cat1.id, cat2.id, cat3.id].sort());
    expect(supermarket.getSupermarketDetail(loser.id)).toBe(null);
  });
});
