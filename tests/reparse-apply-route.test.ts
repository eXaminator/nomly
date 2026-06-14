import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-reparse-apply-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

let db: typeof import("@/db").db;
let schema: typeof import("@/db/schema");
let POST: typeof import("@/app/api/v1/recipes/reparse-apply/route").POST;

// Catalog fixture ids, created once in beforeAll.
let gramId: number;
let tomateId: number;
let salzId: number;
let zuckerId: number;

beforeAll(async () => {
  db = (await import("@/db")).db;
  schema = await import("@/db/schema");
  POST = (await import("@/app/api/v1/recipes/reparse-apply/route")).POST;

  // Clean slate (migrations may seed a catalog).
  db.delete(schema.recipeTag).run();
  db.delete(schema.recipeIngredient).run();
  db.delete(schema.recipeSection).run();
  db.delete(schema.recipe).run();
  db.delete(schema.ingredientAlias).run();
  db.delete(schema.ingredient).run();

  gramId = db
    .insert(schema.unit)
    .values({ name: "Testgramm", dimension: "mass" })
    .returning({ id: schema.unit.id })
    .all()[0].id;
  const ins = (name: string, dietaryClass?: "vegan" | "vegetarian" | "meat") =>
    db
      .insert(schema.ingredient)
      .values({ name, dietaryClass: dietaryClass ?? null })
      .returning({ id: schema.ingredient.id })
      .all()[0].id;
  tomateId = ins("Tomate", "vegan");
  salzId = ins("Salz", "vegan");
  zuckerId = ins("Zucker", "vegan");
  db.insert(schema.ingredientAlias)
    .values({ ingredientId: tomateId, name: "Strauchtomate" })
    .run();
});

/** Insert a recipe with one section and the given rows; returns ids. */
function makeRecipe(
  title: string,
  rows: Array<{
    displayName: string;
    ingredientId?: number | null;
    quantity?: number | null;
    unitId?: number | null;
    rawLine?: string | null;
  }>,
): { recipeId: number; sectionId: number; rowIds: number[] } {
  const recipeId = db
    .insert(schema.recipe)
    .values({ title })
    .returning({ id: schema.recipe.id })
    .all()[0].id;
  const sectionId = db
    .insert(schema.recipeSection)
    .values({ recipeId, sortOrder: 0, instructions: "" })
    .returning({ id: schema.recipeSection.id })
    .all()[0].id;
  const rowIds = rows.map(
    (r, i) =>
      db
        .insert(schema.recipeIngredient)
        .values({
          sectionId,
          ingredientId: r.ingredientId ?? null,
          displayName: r.displayName,
          quantity: r.quantity ?? null,
          unitId: r.unitId ?? null,
          rawLine: r.rawLine ?? r.displayName,
          sortOrder: i,
        })
        .returning({ id: schema.recipeIngredient.id })
        .all()[0].id,
  );
  return { recipeId, sectionId, rowIds };
}

/** Payload row with required fields defaulted. */
function prow(over: Record<string, unknown> = {}) {
  return {
    ingredientName: "X",
    ingredientId: null,
    quantity: null,
    unitId: null,
    displayUnit: null,
    notes: null,
    isOptional: false,
    fixedAmount: false,
    rawLine: null,
    ...over,
  };
}

function post(body: unknown) {
  return POST(
    new Request("http://test/api/v1/recipes/reparse-apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/v1/recipes/reparse-apply", () => {
  it("applies a mixed batch (alias-add + new ingredient + repick + unassigned + alternative) and keeps untouched rows intact", async () => {
    const { recipeId, rowIds } = makeRecipe("Mixed", [
      { displayName: "Tomaten", rawLine: "2 Tomaten" },
      {
        displayName: "Salz",
        ingredientId: salzId,
        quantity: 100,
        unitId: gramId,
        rawLine: "100 g Salz",
      },
    ]);

    const res = await post({
      recipes: [
        {
          recipeId,
          replacements: [
            {
              replaceRowIds: [rowIds[0]],
              rows: [
                // Keep original spelling, pin to Tomate, remember as alias.
                prow({
                  ingredientName: "Tomaten",
                  ingredientId: tomateId,
                  addAsAlias: true,
                  quantity: 2,
                  rawLine: "2 Tomaten",
                }),
                // Alternative to the row above.
                prow({
                  ingredientName: "Strauchtomate",
                  ingredientId: tomateId,
                  isAlternative: true,
                }),
                // Brand-new ingredient with collected defaults.
                prow({ ingredientName: "Bergkäse" }),
                // Repick: keep spelling, link a different article, no alias.
                prow({ ingredientName: "Meersalz", ingredientId: salzId }),
                // Unassigned free text: amount must be dropped.
                prow({ ingredientName: "Liebe", unassigned: true, quantity: 3 }),
              ],
            },
          ],
        },
      ],
      newIngredientDefaults: [
        {
          name: "Bergkäse",
          defaultCategoryId: null,
          dietaryClass: "vegetarian",
          excludeFromShoppingList: false,
          isEquipment: false,
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updatedRecipes).toBe(1);
    expect(body.updatedGroups).toBe(1);
    expect(body.aliasWarnings).toEqual([]);

    // Alias "Tomaten" → Tomate was created.
    const aliases = db
      .select()
      .from(schema.ingredientAlias)
      .all()
      .filter((a) => a.name === "Tomaten");
    expect(aliases).toHaveLength(1);
    expect(aliases[0].ingredientId).toBe(tomateId);

    // New ingredient exists with its defaults applied.
    const bergkaese = db
      .select()
      .from(schema.ingredient)
      .all()
      .find((i) => i.name === "Bergkäse");
    expect(bergkaese).toBeDefined();
    expect(bergkaese!.dietaryClass).toBe("vegetarian");

    const rows = db
      .select()
      .from(schema.recipeIngredient)
      .all()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((r) =>
        ["Tomaten", "Strauchtomate", "Bergkäse", "Meersalz", "Liebe", "Salz"].includes(
          r.displayName ?? "",
        ),
      );
    const byName = new Map(rows.map((r) => [r.displayName, r]));
    expect(byName.get("Tomaten")!.ingredientId).toBe(tomateId);
    // Alternative links to the new primary and is forced optional.
    expect(byName.get("Strauchtomate")!.alternativeForId).toBe(byName.get("Tomaten")!.id);
    expect(byName.get("Strauchtomate")!.isOptional).toBe(true);
    expect(byName.get("Bergkäse")!.ingredientId).toBe(bergkaese!.id);
    expect(byName.get("Meersalz")!.ingredientId).toBe(salzId);
    // Unassigned: no link, amount dropped.
    expect(byName.get("Liebe")!.ingredientId).toBeNull();
    expect(byName.get("Liebe")!.quantity).toBeNull();
    // Untouched row survives the rebuild with its values.
    const salt = byName.get("Salz")!;
    expect(salt.ingredientId).toBe(salzId);
    expect(salt.quantity).toBe(100);
    expect(salt.unitId).toBe(gramId);
  });

  it("creates a shared new ingredient once across recipes (case-insensitive)", async () => {
    const a = makeRecipe("Share A", [{ displayName: "Wakame" }]);
    const b = makeRecipe("Share B", [{ displayName: "wakame" }]);
    const res = await post({
      recipes: [
        {
          recipeId: a.recipeId,
          replacements: [
            { replaceRowIds: [a.rowIds[0]], rows: [prow({ ingredientName: "Wakame" })] },
          ],
        },
        {
          recipeId: b.recipeId,
          replacements: [
            { replaceRowIds: [b.rowIds[0]], rows: [prow({ ingredientName: "wakame" })] },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    const wakames = db
      .select()
      .from(schema.ingredient)
      .all()
      .filter((i) => i.name.toLowerCase() === "wakame");
    expect(wakames).toHaveLength(1);
    const linked = db
      .select()
      .from(schema.recipeIngredient)
      .all()
      .filter((r) => (r.displayName ?? "").toLowerCase() === "wakame");
    expect(linked).toHaveLength(2);
    for (const r of linked) expect(r.ingredientId).toBe(wakames[0].id);
  });

  it("returns 409 with stale details and applies NOTHING when any group is stale", async () => {
    const ok = makeRecipe("Stale OK", [{ displayName: "Apfel Alt" }]);
    const gone = makeRecipe("Stale Gone", [{ displayName: "Birne" }]);
    const res = await post({
      recipes: [
        {
          recipeId: ok.recipeId,
          replacements: [
            {
              replaceRowIds: [ok.rowIds[0]],
              rows: [prow({ ingredientName: "Apfel Neu" })],
            },
          ],
        },
        {
          recipeId: gone.recipeId,
          // Row id that no longer exists (recipe edited since the scan).
          replacements: [
            { replaceRowIds: [999999], rows: [prow({ ingredientName: "Birne Neu" })] },
          ],
        },
        {
          // Whole recipe vanished.
          recipeId: 888888,
          replacements: [
            { replaceRowIds: [777777], rows: [prow({ ingredientName: "Nix" })] },
          ],
        },
      ],
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("stale");
    expect(body.stale).toEqual(
      expect.arrayContaining([
        { recipeId: gone.recipeId, replaceRowIds: [999999] },
        { recipeId: 888888, replaceRowIds: [777777] },
      ]),
    );
    expect(body.stale).toHaveLength(2);

    // The valid recipe was NOT touched (all-or-nothing) …
    const okRows = db
      .select()
      .from(schema.recipeIngredient)
      .all()
      .filter((r) => r.id === ok.rowIds[0]);
    expect(okRows).toHaveLength(1);
    expect(okRows[0].displayName).toBe("Apfel Alt");
    // … and no stray ingredient was created.
    expect(
      db
        .select()
        .from(schema.ingredient)
        .all()
        .some((i) => i.name === "Apfel Neu"),
    ).toBe(false);
  });

  it("rolls back the whole batch when one recipe's update throws (atomicity)", async () => {
    const first = makeRecipe("Atomic A", [{ displayName: "Kirsche Alt" }]);
    const second = makeRecipe("Atomic B", [{ displayName: "Pflaume" }]);
    const res = await post({
      recipes: [
        {
          recipeId: first.recipeId,
          replacements: [
            {
              replaceRowIds: [first.rowIds[0]],
              // Also creates a new ingredient — must vanish on rollback.
              rows: [prow({ ingredientName: "Kirsche Neu" })],
            },
          ],
        },
        {
          recipeId: second.recipeId,
          replacements: [
            {
              replaceRowIds: [second.rowIds[0]],
              // Nonexistent unit id → FK violation mid-transaction.
              rows: [prow({ ingredientName: "Pflaume Neu", unitId: 424242 })],
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(500);

    const firstRows = db
      .select()
      .from(schema.recipeIngredient)
      .all()
      .filter((r) => r.id === first.rowIds[0]);
    expect(firstRows).toHaveLength(1);
    expect(firstRows[0].displayName).toBe("Kirsche Alt");
    expect(
      db
        .select()
        .from(schema.ingredient)
        .all()
        .some((i) => i.name === "Kirsche Neu"),
    ).toBe(false);
  });

  it("skips + warns when the alias spelling is another ingredient's CANONICAL name", async () => {
    const r = makeRecipe("Canon", [{ displayName: "Zucker" }]);
    const res = await post({
      recipes: [
        {
          recipeId: r.recipeId,
          replacements: [
            {
              replaceRowIds: [r.rowIds[0]],
              rows: [
                prow({ ingredientName: "Zucker", ingredientId: salzId, addAsAlias: true }),
              ],
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aliasWarnings).toEqual([
      {
        aliasName: "Zucker",
        kind: "canonical",
        otherIngredientNames: ["Zucker"],
        created: false,
      },
    ]);
    // No alias row was inserted; the row mapping itself was still honored.
    expect(
      db
        .select()
        .from(schema.ingredientAlias)
        .all()
        .some((a) => a.name === "Zucker"),
    ).toBe(false);
    const row = db
      .select()
      .from(schema.recipeIngredient)
      .all()
      .find((x) => x.displayName === "Zucker" && x.ingredientId === salzId);
    expect(row).toBeDefined();
  });

  it("creates + warns when the alias spelling collides with another ingredient's alias", async () => {
    const r = makeRecipe("Collide", [{ displayName: "Strauchtomate" }]);
    const res = await post({
      recipes: [
        {
          recipeId: r.recipeId,
          replacements: [
            {
              replaceRowIds: [r.rowIds[0]],
              rows: [
                prow({
                  ingredientName: "Strauchtomate",
                  ingredientId: zuckerId,
                  addAsAlias: true,
                }),
              ],
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aliasWarnings).toEqual([
      {
        aliasName: "Strauchtomate",
        kind: "collision",
        otherIngredientNames: ["Tomate"],
        created: true,
      },
    ]);
    // The collision alias WAS created for the requested ingredient …
    const owners = db
      .select()
      .from(schema.ingredientAlias)
      .all()
      .filter((a) => a.name === "Strauchtomate")
      .map((a) => a.ingredientId)
      .sort();
    expect(owners).toEqual([tomateId, zuckerId].sort());
  });

  it("is idempotent (no warning, no duplicate) when the spelling already covers the same ingredient", async () => {
    const r = makeRecipe("Idem", [
      { displayName: "Strauchtomate" },
      { displayName: "Tomate" },
    ]);
    const res = await post({
      recipes: [
        {
          recipeId: r.recipeId,
          replacements: [
            {
              replaceRowIds: [r.rowIds[0]],
              // Already an alias of Tomate.
              rows: [
                prow({
                  ingredientName: "Strauchtomate",
                  ingredientId: tomateId,
                  addAsAlias: true,
                }),
              ],
            },
            {
              replaceRowIds: [r.rowIds[1]],
              // The ingredient's own canonical name.
              rows: [
                prow({ ingredientName: "Tomate", ingredientId: tomateId, addAsAlias: true }),
              ],
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aliasWarnings).toEqual([]);
    expect(body.updatedGroups).toBe(2);
    const dupes = db
      .select()
      .from(schema.ingredientAlias)
      .all()
      .filter((a) => a.name === "Strauchtomate" && a.ingredientId === tomateId);
    expect(dupes).toHaveLength(1);
    expect(
      db
        .select()
        .from(schema.ingredientAlias)
        .all()
        .some((a) => a.name === "Tomate"),
    ).toBe(false);
  });

  it("persists a quantifier reference (regression: the row schema dropped quantifierId)", async () => {
    // "a small bunch coriander" → quantifier "a"/"ein" (value 1) claims the
    // amount slot; the persisted row must carry quantifierId (quantity null),
    // not lose the amount entirely.
    const ein = db
      .select()
      .from(schema.quantifier)
      .all()
      .find((q) => q.name === "ein");
    expect(ein, "default quantifier 'ein' should be seeded by migrations").toBeDefined();

    const korianderId = db
      .insert(schema.ingredient)
      .values({ name: "Koriander" })
      .returning({ id: schema.ingredient.id })
      .all()[0].id;
    const bundId = db
      .insert(schema.unit)
      .values({ name: "Testbund", dimension: "count" })
      .returning({ id: schema.unit.id })
      .all()[0].id;

    const { recipeId, rowIds } = makeRecipe("Quant", [
      { displayName: "Koriander", rawLine: "a small bunch coriander" },
    ]);

    const res = await post({
      recipes: [
        {
          recipeId,
          replacements: [
            {
              replaceRowIds: [rowIds[0]],
              rows: [
                prow({
                  ingredientName: "Koriander",
                  ingredientId: korianderId,
                  quantity: null,
                  quantifierId: ein!.id,
                  // The matched source word — must survive, not collapse to "ein".
                  displayQuantifier: "a",
                  unitId: bundId,
                  rawLine: "a small bunch coriander",
                }),
              ],
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);

    const row = db
      .select()
      .from(schema.recipeIngredient)
      .all()
      .find((r) => r.displayName === "Koriander" && r.unitId === bundId);
    expect(row).toBeDefined();
    expect(row!.quantifierId).toBe(ein!.id);
    expect(row!.quantity).toBeNull();
    // The source word is preserved so the amount field can show "a", not "ein".
    expect(row!.displayQuantifier).toBe("a");

    // …and the read model exposes it as quantifierSource for the edit form.
    const getRecipe = (await import("@/lib/recipes/service")).getRecipe;
    const view = getRecipe(recipeId)!;
    const ing = view.sections
      .flatMap((s) => s.ingredients)
      .find((i) => i.ingredientName === "Koriander");
    expect(ing?.quantifierSource).toBe("a");
    expect(ing?.quantifierValue).toBe(1);
  });
});
