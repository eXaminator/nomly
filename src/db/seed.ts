import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql, eq } from "drizzle-orm";
import { db } from "./index.ts";
import {
  category,
  ingredient,
  ingredientAlias,
  supermarket,
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

type TandoorStore = { name: string };

type TandoorSeed = {
  unit: Record<string, TandoorUnit>;
  category: Record<string, TandoorCategory>;
  food: Record<string, TandoorFood>;
  store: Record<string, TandoorStore>;
};

export type SeedCounts = {
  units: { added: number; skipped: number; aliasesAdded: number };
  categories: { added: number; skipped: number };
  ingredients: { added: number; skipped: number; aliasesAdded: number };
  supermarkets: { added: number; skipped: number };
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

// Top-up units the app expects even if the snapshot lacks them. The current
// Tandoor snapshot already contains EL/TL/Prise, but this guarantees they
// exist after any snapshot replacement (§7.1 Epic 1).
const topUpUnits: Array<{
  name: string;
  dimension: "mass" | "volume" | "count";
  factor: number;
  basedOn?: { dimension: "mass" | "volume" | "count" };
}> = [
  { name: "EL", dimension: "volume", factor: 14.7867647813 },
  { name: "TL", dimension: "volume", factor: 4.92892159375 },
  { name: "Prise", dimension: "volume", factor: 0.3 },
];

function readSeed(): TandoorSeed {
  const path = resolve(process.cwd(), "data/seed/tandoor-de.json");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as TandoorSeed;
}

/**
 * Idempotent: a row whose canonical name matches (case-insensitive, trimmed)
 * an existing row in the same namespace is skipped. Aliases are inserted even
 * when the parent already exists, allowing a refreshed snapshot to add new
 * aliases without duplicating entries.
 */
export function runSeed(): SeedCounts {
  const seed = readSeed();
  const counts: SeedCounts = {
    units: { added: 0, skipped: 0, aliasesAdded: 0 },
    categories: { added: 0, skipped: 0 },
    ingredients: { added: 0, skipped: 0, aliasesAdded: 0 },
    supermarkets: { added: 0, skipped: 0 },
  };

  db.transaction((tx) => {
    // -- Units (first pass: insert without base_unit_id) --
    // Tandoor key → our db row id
    const unitIdByKey = new Map<string, number>();
    // canonical lowercase name → db row id (for top-ups + lookups)
    const unitIdByName = new Map<string, number>();

    for (const row of tx.select().from(unit).all()) {
      unitIdByName.set(lower(row.name), row.id);
    }

    for (const [key, u] of Object.entries(seed.unit)) {
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
        const aliasName = norm(u.plural_name);
        const exists = tx
          .select({ id: unitAlias.id })
          .from(unitAlias)
          .where(eq(unitAlias.name, aliasName))
          .get();
        if (!exists) {
          try {
            tx.insert(unitAlias).values({ unitId: id, name: aliasName }).run();
            counts.units.aliasesAdded += 1;
          } catch {
            // Collision with another namespace's row — alias must be globally
            // unique. Skip silently; the rest of the seed should still apply.
          }
        }
      }
    }

    // Resolve base_unit_id self-refs (best-effort: link to a unit in the same
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
      if (unitIdByName.has(top.name.toLowerCase())) continue;
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
        })
        .returning({ id: unit.id })
        .all();
      unitIdByName.set(top.name.toLowerCase(), inserted[0].id);
      counts.units.added += 1;
    }

    // -- Categories --
    const categoryIdByKey = new Map<string, number>();
    const categoryIdByName = new Map<string, number>();
    for (const row of tx.select().from(category).all()) {
      categoryIdByName.set(lower(row.name), row.id);
    }
    for (const [key, c] of Object.entries(seed.category)) {
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

    // -- Supermarkets --
    const existingMarkets = new Set(
      tx
        .select({ name: supermarket.name })
        .from(supermarket)
        .all()
        .map((r) => lower(r.name)),
    );
    for (const [, s] of Object.entries(seed.store)) {
      const name = norm(s.name);
      if (existingMarkets.has(lower(name))) {
        counts.supermarkets.skipped += 1;
        continue;
      }
      tx.insert(supermarket).values({ name }).run();
      existingMarkets.add(lower(name));
      counts.supermarkets.added += 1;
    }

    // -- Ingredients --
    const ingredientIdByName = new Map<string, number>();
    for (const row of tx.select().from(ingredient).all()) {
      ingredientIdByName.set(lower(row.name), row.id);
    }
    for (const [, f] of Object.entries(seed.food)) {
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

      if (f.plural_name && lower(f.plural_name) !== lower(name)) {
        const aliasName = norm(f.plural_name);
        const exists = tx
          .select({ id: ingredientAlias.id })
          .from(ingredientAlias)
          .where(eq(ingredientAlias.name, aliasName))
          .get();
        if (!exists) {
          try {
            tx.insert(ingredientAlias)
              .values({ ingredientId: id, name: aliasName })
              .run();
            counts.ingredients.aliasesAdded += 1;
          } catch {
            // Globally-unique alias collided with another namespace; skip.
          }
        }
      }
    }
  });

  return counts;
}
