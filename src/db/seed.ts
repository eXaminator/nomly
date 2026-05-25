import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql, eq } from "drizzle-orm";
import { db } from "./index.ts";
import {
  category,
  categoryAlias,
  ingredient,
  ingredientAlias,
  ingredientSubUnit,
  unit,
  unitAlias,
} from "./schema.ts";

type TandoorUnit = {
  name: string;
  plural_name?: string;
  type: "WEIGHT" | "VOLUME" | "OTHER";
  base_unit?: string;
};

type TandoorCategory = { name: string };

type TandoorFood = {
  name: string;
  plural_name?: string;
  store_category?: string;
};

type TandoorSeed = {
  unit: Record<string, TandoorUnit>;
  category: Record<string, TandoorCategory>;
  food: Record<string, TandoorFood>;
};

export type SeedCounts = {
  units: { added: number; skipped: number; aliasesAdded: number };
  categories: { added: number; skipped: number; aliasesAdded: number };
  ingredients: { added: number; skipped: number; aliasesAdded: number };
  subUnits: {
    /** New ingredient_sub_unit rows inserted (skips when one already exists
     *  on the same (ingredient, name) — preserves user edits to per_purchase). */
    added: number;
    /** New compound-noun aliases inserted with default_sub_unit_id set
     *  (e.g. "Knoblauchzehe" → Knoblauch + sub-unit Zehe). Existing aliases
     *  are left untouched. */
    aliasesAdded: number;
    /** Ingredients whose `purchase_unit_id` got filled in from the top-up
     *  table (skipped when the user already chose one). */
    purchaseUnitsSet: number;
  };
};

const norm = (s: string) => s.trim();
const lower = (s: string) => norm(s).toLowerCase();

const tandoorTypeToDimension = (t: TandoorUnit["type"]) =>
  t === "WEIGHT" ? "mass" : t === "VOLUME" ? "volume" : "count";

// Conversion factors keyed by Tandoor base_unit string (the physical canonical
// name, not a Tandoor unit key). Values are factors to the per-dimension base.
const massFactorToGram: Record<string, number> = {
  g: 1,
  kg: 1000,
  pound: 453.59237,
  ounce: 28.349523125,
};

const volumeFactorToMl: Record<string, number> = {
  ml: 1,
  l: 1000,
  fluid_ounce: 29.5735295625,
  tbsp: 14.7867647813,
  tsp: 4.92892159375,
  us_cup: 236.5882365,
};

/**
 * Supplementary unit aliases that bridge the gap between Tandoor's English
 * abbreviations (the en.json snapshot ships `tbsp`, `tsp`, `pcs`, `lb`) and
 * the full-word spellings that recipe sites actually use ("tablespoon",
 * "teaspoon"). Each value is the canonical German unit name to attach to —
 * matched the same way the Tandoor pass does. Skipped silently if the
 * canonical isn't present.
 */
const fullWordUnitAliases: Record<string, string> = {
  tablespoon: "EL",
  tablespoons: "EL",
  Esslöffel: "EL",
  esslöffel: "EL",
  Eßlöffel: "EL",
  teaspoon: "TL",
  teaspoons: "TL",
  Teelöffel: "TL",
  teelöffel: "TL",
  piece: "Stück",
  pieces: "Stück",
  pound: "lb",
  pounds: "lb",
  ounce: "oz",
  ounces: "oz",
  gram: "g",
  grams: "g",
  Gramm: "g",
  gramm: "g",
  // German shortform abbreviation — common in recipe sites ("150 gr.
  // Joghurt", "200 gr Mehl"). Parser strips trailing periods before lookup,
  // so the `"gr."` entry is just belt-and-suspenders.
  gr: "g",
  "gr.": "g",
  kilogram: "kg",
  kilograms: "kg",
  Kilogramm: "kg",
  kilogramm: "kg",
  Kilo: "kg",
  kilo: "kg",
  milliliter: "ml",
  milliliters: "ml",
  Milliliter: "ml",
  liter: "l",
  liters: "l",
  Liter: "l",
  cups: "cup",
  Tasse: "cup",
  tassen: "cup",
  Tassen: "cup",
  // "c." appears in mixed German/English recipes — most commonly an
  // abbreviation for "cup". Treat as such.
  "c.": "cup",
  c: "cup",
};

// Top-up units the app expects even if the snapshot lacks them. The current
// Tandoor snapshot already contains EL/TL/Prise, but this guarantees they
// exist after any snapshot replacement (§7.1 Epic 1). "Packung" is genuinely
// missing from upstream and shows up often in German recipes ("1 Päckchen
// Hefe").
const topUpUnits: Array<{
  name: string;
  dimension: "mass" | "volume" | "count";
  factor: number;
  aliases?: string[];
  /** When true, this unit row is marked as a physical container. The
   *  ingredient parser uses this flag to keep prep adjectives attached to
   *  the product name ("1 Dose chopped tomatoes"). */
  isContainer?: boolean;
}> = [
  { name: "EL", dimension: "volume", factor: 14.7867647813 },
  { name: "TL", dimension: "volume", factor: 4.92892159375 },
  {
    name: "Prise",
    dimension: "volume",
    factor: 0.3,
    aliases: ["Prisen", "PR", "pinch", "pinches"],
  },
  {
    name: "Messerspitze",
    dimension: "volume",
    factor: 0.5,
    aliases: ["Messerspitzen", "Msp", "Msp.", "knife tip"],
  },
  {
    name: "Bund",
    dimension: "count",
    factor: 1,
    aliases: ["Bunde", "Bündel", "Bd.", "Bd", "bunch", "bunches"],
  },
  {
    name: "Stück",
    dimension: "count",
    factor: 1,
    aliases: [
      "Stk",
      "Stk.",
      "St.",
      "x",
      "piece",
      "pieces",
      "stick",
      "sticks",
    ],
  },
  {
    name: "Handvoll",
    dimension: "count",
    factor: 1,
    aliases: ["Hand voll", "handful", "handfuls"],
  },
  // Mais — purchased by the cob, used by the cob. Familywall catalog
  // assigns this as the default purchaseUnit for corn.
  {
    name: "Kolben",
    dimension: "count",
    factor: 1,
    aliases: ["Kolben", "cob", "cobs", "ear of corn", "ears of corn"],
  },
  // Zehe and Zweig used to live here as global count units. They're now
  // modelled as ingredient-scoped sub-units (Knoblauch → Zehe, Petersilie →
  // Zweig), so the parser only recognises them in the context of an
  // ingredient that defines them.
  {
    name: "Zoll",
    dimension: "count",
    factor: 1,
    // English `inch` and the symbol `"` (single straight quote). Recipe
    // sites often write `1" piece ginger`.
    aliases: ["inch", "inches", "-inch", "Inch", '"'],
  },
  {
    name: "cm",
    dimension: "count",
    factor: 1,
    aliases: ["zentimeter", "Zentimeter", "centimeter", "centimeters", "-cm"],
  },
  {
    name: "Packung",
    dimension: "count",
    factor: 1,
    isContainer: true,
    aliases: [
      "Packungen",
      "Päckchen",
      "Pck",
      "Pck.",
      "Pkg",
      "Pkg.",
      "Pckg",
      "Pckg.",
      "package",
      "packages",
      "packet",
      "packets",
    ],
  },
  {
    name: "Dose",
    dimension: "count",
    factor: 1,
    isContainer: true,
    aliases: ["Dosen", "can", "cans", "tin", "tins"],
  },
  {
    name: "Glas",
    dimension: "count",
    factor: 1,
    isContainer: true,
    aliases: ["Gläser", "jar", "jars"],
  },
  {
    name: "Tube",
    dimension: "count",
    factor: 1,
    isContainer: true,
    aliases: ["Tuben", "tubes"],
  },
  {
    name: "Flasche",
    dimension: "count",
    factor: 1,
    isContainer: true,
    aliases: ["Flaschen", "bottle", "bottles"],
  },
  {
    name: "Karton",
    dimension: "count",
    factor: 1,
    isContainer: true,
    aliases: ["Kartons", "carton", "cartons"],
  },
  {
    name: "Schachtel",
    dimension: "count",
    factor: 1,
    isContainer: true,
    aliases: ["Schachteln", "box", "boxes"],
  },
  {
    name: "Beutel",
    dimension: "count",
    factor: 1,
    isContainer: true,
    aliases: ["Beuteln", "sachet", "sachets", "bag", "bags"],
  },
];

/**
 * Per-ingredient purchase-unit + sub-unit + alias top-ups, keyed by Tandoor
 * food key so we attach to whatever id the snapshot ended up with.
 *
 * `perPurchase` values are first-shopping-pass defaults — typical bulb /
 * bunch yields the user can adjust in Stammdaten once they buy a few of
 * each. Compound-noun aliases (e.g. "Knoblauchzehe") are inserted with
 * `default_sub_unit_id` pointing at the same row, so the parser hits the
 * sub-unit when it sees "1 Knoblauchzehe" without an explicit unit.
 */
const ingredientSubUnitTopUps: Array<{
  foodKey: string;
  /** Canonical name of the purchase unit (looked up against the unit table).
   *  Null leaves the existing setting alone; for new ingredients that
   *  effectively means "default to Stück" via NULL. */
  purchaseUnitName: string | null;
  subUnit: { name: string; perPurchase: number };
  /** Compound-noun aliases that imply the sub-unit when matched. The seeder
   *  inserts each as an `ingredient_alias` row with `default_sub_unit_id`
   *  pointing at the sub-unit. Pre-existing aliases are left untouched. */
  aliases: string[];
}> = [
  // Stück purchase unit, ~10 Zehen per Knoblauch bulb.
  {
    foodKey: "food-garlic-raw",
    purchaseUnitName: null,
    subUnit: { name: "Zehe", perPurchase: 10 },
    aliases: [
      "Knoblauchzehe",
      "Knoblauchzehen",
      "garlic clove",
      "garlic cloves",
    ],
  },
  // Bund purchase unit + Zweig sub-unit for the fresh-herb ingredients
  // Tandoor ships in German.
  {
    foodKey: "food-parsley",
    purchaseUnitName: "Bund",
    subUnit: { name: "Zweig", perPurchase: 12 },
    aliases: [
      "Petersilienzweig",
      "Petersilienzweige",
      "parsley sprig",
      "parsley sprigs",
    ],
  },
  {
    foodKey: "food-basil-fresh",
    purchaseUnitName: "Bund",
    subUnit: { name: "Zweig", perPurchase: 10 },
    aliases: [
      "Basilikumzweig",
      "Basilikumzweige",
      "basil sprig",
      "basil sprigs",
    ],
  },
  {
    foodKey: "food-cilantro-raw",
    purchaseUnitName: "Bund",
    subUnit: { name: "Zweig", perPurchase: 12 },
    aliases: [
      "Korianderzweig",
      "Korianderzweige",
      "cilantro sprig",
      "cilantro sprigs",
      "coriander sprig",
      "coriander sprigs",
    ],
  },
  {
    foodKey: "food-dill-fresh",
    purchaseUnitName: "Bund",
    subUnit: { name: "Zweig", perPurchase: 15 },
    aliases: ["Dillzweig", "Dillzweige", "dill sprig", "dill sprigs"],
  },
  {
    foodKey: "food-spearmint-fresh",
    purchaseUnitName: "Bund",
    subUnit: { name: "Zweig", perPurchase: 12 },
    aliases: [
      "Minzezweig",
      "Minzezweige",
      "Minzzweig",
      "Minzzweige",
      "mint sprig",
      "mint sprigs",
    ],
  },
  {
    foodKey: "food-rosemary-fresh",
    purchaseUnitName: "Bund",
    subUnit: { name: "Zweig", perPurchase: 8 },
    aliases: [
      "Rosmarinzweig",
      "Rosmarinzweige",
      "rosemary sprig",
      "rosemary sprigs",
    ],
  },
  {
    foodKey: "food-thyme-fresh",
    purchaseUnitName: "Bund",
    subUnit: { name: "Zweig", perPurchase: 10 },
    aliases: [
      "Thymianzweig",
      "Thymianzweige",
      "thyme sprig",
      "thyme sprigs",
    ],
  },
];

function readSeed(file: string): TandoorSeed {
  const path = resolve(process.cwd(), "data/seed", file);
  return JSON.parse(readFileSync(path, "utf8")) as TandoorSeed;
}

/**
 * Idempotent seeder. Loads the German Tandoor snapshot to create the canonical
 * rows (canonical names stay German), then loads the English snapshot to layer
 * its names + plurals as aliases on the rows that share a Tandoor key.
 *
 * - Canonical-name match is case-insensitive + trimmed.
 * - Aliases are added even when the parent already exists, so a refreshed
 *   snapshot can pull in new aliases on a re-run.
 */
export function runSeed(): SeedCounts {
  const de = readSeed("tandoor-de.json");
  const en = readSeed("tandoor-en.json");
  const counts: SeedCounts = {
    units: { added: 0, skipped: 0, aliasesAdded: 0 },
    categories: { added: 0, skipped: 0, aliasesAdded: 0 },
    ingredients: { added: 0, skipped: 0, aliasesAdded: 0 },
    subUnits: { added: 0, aliasesAdded: 0, purchaseUnitsSet: 0 },
  };

  db.transaction((tx) => {
    // -- Units --
    const unitIdByKey = new Map<string, number>();
    const unitIdByName = new Map<string, number>();
    // Track which unit names were already counted in this run, so the
    // top-up loop below doesn't double-count units that overlap with the
    // Tandoor snapshot (EL/TL/Prise).
    const processedThisRun = new Set<string>();
    for (const row of tx.select().from(unit).all()) {
      unitIdByName.set(lower(row.name), row.id);
    }
    for (const [key, u] of Object.entries(de.unit)) {
      const name = norm(u.name);
      const dimension = tandoorTypeToDimension(u.type);
      const factor =
        dimension === "mass"
          ? (massFactorToGram[u.base_unit ?? ""] ?? 1)
          : dimension === "volume"
            ? (volumeFactorToMl[u.base_unit ?? ""] ?? 1)
            : 1;
      const existingId = unitIdByName.get(lower(name));
      let id: number;
      processedThisRun.add(lower(name));
      if (existingId !== undefined) {
        id = existingId;
        counts.units.skipped += 1;
      } else {
        const inserted = tx
          .insert(unit)
          .values({ name, dimension, factor })
          .returning({ id: unit.id })
          .all();
        id = inserted[0].id;
        unitIdByName.set(lower(name), id);
        counts.units.added += 1;
      }
      unitIdByKey.set(key, id);
      if (u.plural_name && lower(u.plural_name) !== lower(name)) {
        addAlias(tx, "unit", id, u.plural_name, () => {
          counts.units.aliasesAdded += 1;
        });
      }
    }

    // base_unit_id self-refs (best-effort: link to a unit in the same
    // dimension if exactly one base exists for that dimension).
    const baseByDimension: Record<"mass" | "volume" | "count", string | null> = {
      mass: "g",
      volume: "ml",
      count: null,
    };
    for (const [dim, baseName] of Object.entries(baseByDimension) as Array<
      [keyof typeof baseByDimension, string | null]
    >) {
      if (!baseName) continue;
      const baseId = unitIdByName.get(baseName.toLowerCase());
      if (baseId === undefined) continue;
      tx.update(unit)
        .set({ baseUnitId: baseId })
        .where(sql`${unit.dimension} = ${dim} AND ${unit.id} != ${baseId} AND ${unit.baseUnitId} IS NULL`)
        .run();
    }

    // Top-up units the app expects.
    for (const top of topUpUnits) {
      const lowerName = top.name.toLowerCase();
      let id = unitIdByName.get(lowerName);
      if (id === undefined) {
        const baseId =
          top.dimension !== "count"
            ? (unitIdByName.get(top.dimension === "mass" ? "g" : "ml") ?? null)
            : null;
        const inserted = tx
          .insert(unit)
          .values({
            name: top.name,
            dimension: top.dimension,
            factor: top.factor,
            baseUnitId: baseId,
            isContainer: top.isContainer ?? false,
          })
          .returning({ id: unit.id })
          .all();
        id = inserted[0].id;
        unitIdByName.set(lowerName, id);
        processedThisRun.add(lowerName);
        counts.units.added += 1;
      } else if (!processedThisRun.has(lowerName)) {
        // The unit existed in the DB at the start of the run (a prior seed
        // added it via this top-up path) and the snapshot loop didn't
        // count it. Count once so re-runs report a consistent skipped tally.
        processedThisRun.add(lowerName);
        counts.units.skipped += 1;
      }
      // Keep the isContainer flag in sync for any unit we top up — even if
      // the row pre-existed (came from Tandoor or a prior run). This lets us
      // add containers to the seed without users having to wipe their DB.
      if (top.isContainer) {
        tx.update(unit)
          .set({ isContainer: true })
          .where(eq(unit.id, id))
          .run();
      }
      for (const alias of top.aliases ?? []) {
        addAlias(tx, "unit", id, alias, () => {
          counts.units.aliasesAdded += 1;
        });
      }
    }

    // -- Categories --
    const categoryIdByKey = new Map<string, number>();
    const categoryIdByName = new Map<string, number>();
    for (const row of tx.select().from(category).all()) {
      categoryIdByName.set(lower(row.name), row.id);
    }
    for (const [key, c] of Object.entries(de.category)) {
      const name = norm(c.name);
      const existing = categoryIdByName.get(lower(name));
      if (existing !== undefined) {
        categoryIdByKey.set(key, existing);
        counts.categories.skipped += 1;
        continue;
      }
      const inserted = tx
        .insert(category)
        .values({ name })
        .returning({ id: category.id })
        .all();
      categoryIdByKey.set(key, inserted[0].id);
      categoryIdByName.set(lower(name), inserted[0].id);
      counts.categories.added += 1;
    }

    // Non-food categories — the Tandoor snapshot is groceries-only, but the
    // catalog now covers household goods (Toilettenpapier, Spülmittel),
    // pharmacy items (Pflaster, Schmerzmittel), and recipe-adjacent
    // equipment (Backpapier, Einmachgläser). Top-up here so a fresh seed has
    // somewhere to put them.
    for (const name of [
      "Hygiene",
      "Drogerie",
      "Haushalt",
      "Küchenbedarf",
      "Tiernahrung",
    ]) {
      if (categoryIdByName.has(lower(name))) {
        counts.categories.skipped += 1;
        continue;
      }
      const inserted = tx
        .insert(category)
        .values({ name })
        .returning({ id: category.id })
        .all();
      categoryIdByName.set(lower(name), inserted[0].id);
      counts.categories.added += 1;
    }

    // -- Ingredients --
    const ingredientIdByKey = new Map<string, number>();
    const ingredientIdByName = new Map<string, number>();
    for (const row of tx.select().from(ingredient).all()) {
      ingredientIdByName.set(lower(row.name), row.id);
    }
    for (const [key, f] of Object.entries(de.food)) {
      const name = norm(f.name);
      const defaultCategoryId = f.store_category
        ? (categoryIdByKey.get(f.store_category) ?? null)
        : null;
      const existingId = ingredientIdByName.get(lower(name));
      let id: number;
      if (existingId !== undefined) {
        id = existingId;
        counts.ingredients.skipped += 1;
      } else {
        const inserted = tx
          .insert(ingredient)
          .values({ name, defaultCategoryId })
          .returning({ id: ingredient.id })
          .all();
        id = inserted[0].id;
        ingredientIdByName.set(lower(name), id);
        counts.ingredients.added += 1;
      }
      ingredientIdByKey.set(key, id);
      if (f.plural_name && lower(f.plural_name) !== lower(name)) {
        addAlias(tx, "ingredient", id, f.plural_name, () => {
          counts.ingredients.aliasesAdded += 1;
        });
      }
    }

    // -- Full-word English unit aliases (gap-filling on top of Tandoor) --
    for (const [aliasName, canonicalName] of Object.entries(fullWordUnitAliases)) {
      const id = unitIdByName.get(lower(canonicalName));
      if (id === undefined) continue;
      addAlias(tx, "unit", id, aliasName, () => {
        counts.units.aliasesAdded += 1;
      });
    }

    // -- English aliases from tandoor-en.json --
    // Each entry shares a Tandoor key with the German snapshot, so we look up
    // the row by key and add the English name + plural as aliases. The
    // canonical name stays German because we never touch ingredient.name here.
    for (const [key, u] of Object.entries(en.unit)) {
      const id = unitIdByKey.get(key);
      if (id === undefined) continue;
      addAlias(tx, "unit", id, u.name, () => {
        counts.units.aliasesAdded += 1;
      });
      if (u.plural_name && lower(u.plural_name) !== lower(u.name)) {
        addAlias(tx, "unit", id, u.plural_name, () => {
          counts.units.aliasesAdded += 1;
        });
      }
    }
    for (const [key, c] of Object.entries(en.category)) {
      const id = categoryIdByKey.get(key);
      if (id === undefined) continue;
      addAlias(tx, "category", id, c.name, () => {
        counts.categories.aliasesAdded += 1;
      });
    }
    for (const [key, f] of Object.entries(en.food)) {
      const id = ingredientIdByKey.get(key);
      if (id === undefined) continue;
      addAlias(tx, "ingredient", id, f.name, () => {
        counts.ingredients.aliasesAdded += 1;
      });
      if (f.plural_name && lower(f.plural_name) !== lower(f.name)) {
        addAlias(tx, "ingredient", id, f.plural_name, () => {
          counts.ingredients.aliasesAdded += 1;
        });
      }
    }

    // -- Ingredient sub-units + alias defaults --
    // Per-ingredient bits the Tandoor snapshot doesn't carry: Knoblauch's
    // Zehe, Petersilie's Zweig, … plus compound-noun aliases that imply the
    // sub-unit. Idempotent on re-runs (skips sub-unit rows that already
    // exist; leaves user-edited per_purchase values alone).
    for (const top of ingredientSubUnitTopUps) {
      const ingredientId = ingredientIdByKey.get(top.foodKey);
      if (ingredientId === undefined) continue;

      if (top.purchaseUnitName) {
        const purchaseUnitId = unitIdByName.get(lower(top.purchaseUnitName));
        if (purchaseUnitId !== undefined) {
          const updated = tx
            .update(ingredient)
            .set({ purchaseUnitId })
            .where(
              sql`${ingredient.id} = ${ingredientId} AND ${ingredient.purchaseUnitId} IS NULL`,
            )
            .run();
          if ((updated.changes ?? 0) > 0) counts.subUnits.purchaseUnitsSet += 1;
        }
      }

      // Preserve user-edited per_purchase values on re-run. The earlier
      // migration created sub-unit rows with per_purchase=1 as a placeholder
      // — anything that's still exactly 1 is treated as un-customised and
      // gets the new seed default; anything else is left alone.
      const existingSub = tx
        .select({
          id: ingredientSubUnit.id,
          perPurchase: ingredientSubUnit.perPurchase,
        })
        .from(ingredientSubUnit)
        .where(
          sql`${ingredientSubUnit.ingredientId} = ${ingredientId} AND ${ingredientSubUnit.name} = ${top.subUnit.name}`,
        )
        .get();
      let subUnitId: number;
      if (existingSub) {
        subUnitId = existingSub.id;
        if (existingSub.perPurchase === 1 && top.subUnit.perPurchase !== 1) {
          tx.update(ingredientSubUnit)
            .set({ perPurchase: top.subUnit.perPurchase })
            .where(eq(ingredientSubUnit.id, subUnitId))
            .run();
        }
      } else {
        const inserted = tx
          .insert(ingredientSubUnit)
          .values({
            ingredientId,
            name: top.subUnit.name,
            perPurchase: top.subUnit.perPurchase,
          })
          .returning({ id: ingredientSubUnit.id })
          .all();
        subUnitId = inserted[0].id;
        counts.subUnits.added += 1;
      }

      for (const aliasName of top.aliases) {
        const cleaned = norm(aliasName);
        if (cleaned.length === 0) continue;
        const exists = tx
          .select({ id: ingredientAlias.id })
          .from(ingredientAlias)
          .where(eq(ingredientAlias.name, cleaned))
          .get();
        if (exists) continue;
        try {
          tx.insert(ingredientAlias)
            .values({
              ingredientId,
              name: cleaned,
              defaultSubUnitId: subUnitId,
            })
            .run();
          counts.subUnits.aliasesAdded += 1;
        } catch {
          // Globally-unique alias name collided with another entity. Skip —
          // the user can resolve in Stammdaten.
        }
      }
    }
  });

  return counts;
}

/**
 * Insert an alias unless one with the same globally-unique name already
 * exists. Aliases live in the unit_alias / ingredient_alias / category_alias
 * tables; the `kind` param selects which.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function addAlias(
  tx: Tx,
  kind: "unit" | "ingredient" | "category",
  parentId: number,
  rawName: string,
  onAdded: () => void,
): void {
  const aliasName = norm(rawName);
  if (aliasName.length === 0) return;
  const table =
    kind === "unit"
      ? unitAlias
      : kind === "ingredient"
        ? ingredientAlias
        : categoryAlias;
  const exists = tx
    .select({ id: table.id })
    .from(table)
    .where(eq(table.name, aliasName))
    .get();
  if (exists) return;
  try {
    if (kind === "unit") {
      tx.insert(unitAlias).values({ unitId: parentId, name: aliasName }).run();
    } else if (kind === "ingredient") {
      tx.insert(ingredientAlias)
        .values({ ingredientId: parentId, name: aliasName })
        .run();
    } else {
      tx.insert(categoryAlias)
        .values({ categoryId: parentId, name: aliasName })
        .run();
    }
    onAdded();
  } catch {
    // Alias name collides with another globally-unique row; skip.
  }
}
