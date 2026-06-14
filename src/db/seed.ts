import { sql, eq } from "drizzle-orm";
import { db } from "./index.ts";
import {
  category,
  ingredientAlias,
  quantifier,
  quantifierAlias,
  unit,
  unitAlias,
} from "./schema.ts";
import { SEED_UNITS } from "./seed-data/units.ts";
import { SEED_CATEGORIES } from "./seed-data/categories.ts";
import { SEED_QUANTIFIERS } from "./seed-data/quantifiers.ts";

export type SeedCounts = {
  units: { added: number; skipped: number; aliasesAdded: number };
  categories: { added: number; skipped: number; aliasesAdded: number };
  quantifiers: { added: number; skipped: number; aliasesAdded: number };
};

const norm = (s: string) => s.trim();
const lower = (s: string) => norm(s).toLowerCase();

/**
 * App-specific unit additions on top of the curated `SEED_UNITS` list —
 * mostly container units (Packung, Glas, Dose, …) that the recipe parser
 * needs to flag as `isContainer=true`, plus a handful of vocabulary the
 * matcher relies on (Bund, Handvoll, Zoll, cm). Idempotent; aliases are
 * merged into the existing canonical when a name overlaps.
 */
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
  {
    name: "Prise",
    dimension: "volume",
    factor: 0.3,
    aliases: ["PR"],
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
  // Mais — purchased by the cob, used by the cob. Catalog assigns this as
  // the default purchaseUnit for corn.
  {
    name: "Kolben",
    dimension: "count",
    factor: 1,
    aliases: ["Kolben", "cob", "cobs", "ear of corn", "ears of corn"],
  },
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
    aliases: ["tin", "tins"],
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
 * Non-food categories the catalog needs but the curated supermarket-style
 * `SEED_CATEGORIES` doesn't carry. The catalog references these by name
 * (Hygiene, Drogerie, Haushalt, Küchenbedarf, Tiernahrung) and the seeder
 * tops them up after the main pass.
 */
const topUpCategories = [
  "Hygiene",
  "Drogerie",
  "Haushalt",
  "Küchenbedarf",
  "Tiernahrung",
];

/**
 * Idempotent seeder. Inserts the curated `SEED_UNITS` + `SEED_CATEGORIES`
 * (extracted from the original Tandoor snapshot and now owned by this
 * repo), tops up app-specific extras (container units, household
 * categories), and wires base-unit references for the mass/volume
 * dimensions. Ingredient rows are NOT inserted here — the familywall
 * catalog seed owns ingredient identity and runs after this.
 *
 * - Canonical-name match is case-insensitive + trimmed.
 * - Aliases are added even when the parent already exists, so updates to
 *   `SEED_UNITS` / `topUpUnits` on a re-run can pull in new aliases.
 */
export function runSeed(): SeedCounts {
  const counts: SeedCounts = {
    units: { added: 0, skipped: 0, aliasesAdded: 0 },
    categories: { added: 0, skipped: 0, aliasesAdded: 0 },
    quantifiers: { added: 0, skipped: 0, aliasesAdded: 0 },
  };

  db.transaction((tx) => {
    // -- Units --
    const unitIdByName = new Map<string, number>();
    const processedThisRun = new Set<string>();
    for (const row of tx.select().from(unit).all()) {
      unitIdByName.set(lower(row.name), row.id);
    }
    for (const u of SEED_UNITS) {
      const name = norm(u.name);
      const existingId = unitIdByName.get(lower(name));
      let id: number;
      processedThisRun.add(lower(name));
      if (existingId !== undefined) {
        id = existingId;
        counts.units.skipped += 1;
      } else {
        const inserted = tx
          .insert(unit)
          .values({
            name,
            dimension: u.dimension,
            factor: u.factor,
            // Insert-time default only; never re-applied on a top-up run, so a
            // user's later toggle in the unit UI is preserved.
            displayFraction: u.displayFraction ?? false,
          })
          .returning({ id: unit.id })
          .all();
        id = inserted[0].id;
        unitIdByName.set(lower(name), id);
        counts.units.added += 1;
      }
      for (const aliasName of u.aliases) {
        if (lower(aliasName) === lower(name)) continue;
        addAlias(tx, "unit", id, aliasName, () => {
          counts.units.aliasesAdded += 1;
        });
      }
    }

    // base_unit_id self-refs: link each mass/volume unit to its dimension's
    // canonical base (g for mass, ml for volume). Skipped for count units.
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
        processedThisRun.add(lowerName);
        counts.units.skipped += 1;
      }
      // Keep the isContainer flag in sync for any unit we top up — even if
      // the row pre-existed. This lets us flip a unit to "container" by
      // editing this list, without users having to wipe their DB.
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
    const categoryIdByName = new Map<string, number>();
    for (const row of tx.select().from(category).all()) {
      categoryIdByName.set(lower(row.name), row.id);
    }
    for (const c of SEED_CATEGORIES) {
      const name = norm(c.name);
      const existing = categoryIdByName.get(lower(name));
      if (existing !== undefined) {
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

    for (const name of topUpCategories) {
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

    // -- Quantifiers --
    const quantifierIdByName = new Map<string, number>();
    for (const row of tx.select().from(quantifier).all()) {
      quantifierIdByName.set(lower(row.name), row.id);
    }
    for (let i = 0; i < SEED_QUANTIFIERS.length; i++) {
      const q = SEED_QUANTIFIERS[i];
      const name = norm(q.name);
      const existingId = quantifierIdByName.get(lower(name));
      let id: number;
      if (existingId !== undefined) {
        id = existingId;
        counts.quantifiers.skipped += 1;
      } else {
        const inserted = tx
          .insert(quantifier)
          .values({ name, value: q.value, sortOrder: i })
          .returning({ id: quantifier.id })
          .all();
        id = inserted[0].id;
        quantifierIdByName.set(lower(name), id);
        counts.quantifiers.added += 1;
      }
      for (const aliasName of q.aliases) {
        if (lower(aliasName) === lower(name)) continue;
        addAlias(tx, "quantifier", id, aliasName, () => {
          counts.quantifiers.aliasesAdded += 1;
        });
      }
    }
  });

  return counts;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Insert an alias unless one with the same globally-unique name already
 * exists. Used for unit and ingredient aliases. Categories don't have a
 * separate alias table in the current schema.
 */
function addAlias(
  tx: Tx,
  kind: "unit" | "ingredient" | "quantifier",
  parentId: number,
  rawName: string,
  onAdded: () => void,
): void {
  const aliasName = norm(rawName);
  if (aliasName.length === 0) return;
  const table =
    kind === "unit"
      ? unitAlias
      : kind === "quantifier"
        ? quantifierAlias
        : ingredientAlias;
  const exists = tx
    .select({ id: table.id })
    .from(table)
    .where(eq(table.name, aliasName))
    .get();
  if (exists) return;
  try {
    if (kind === "unit") {
      tx.insert(unitAlias).values({ unitId: parentId, name: aliasName }).run();
    } else if (kind === "quantifier") {
      tx.insert(quantifierAlias)
        .values({ quantifierId: parentId, name: aliasName })
        .run();
    } else {
      tx.insert(ingredientAlias)
        .values({ ingredientId: parentId, name: aliasName })
        .run();
    }
    onAdded();
  } catch {
    // Alias name collides with another globally-unique row; skip.
  }
}
