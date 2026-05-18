import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  ingredient,
  ingredientAlias,
  unit,
  unitAlias,
} from "../../db/schema.ts";
import { fetchUrl, FetchError } from "./fetch.ts";
import {
  asImageUrl,
  asServings,
  asString,
  asStringList,
  extractJsonLdRecipe,
  type JsonLdRecipe,
} from "./json-ld.ts";
import { parseIsoDurationToMinutes } from "./duration.ts";
import { parseIngredientString } from "./ingredient.ts";
import { savePhotoBuffer, type PhotoPath } from "../photos.ts";

export type IngredientMatch = "existing" | "new";
export type UnitMatch =
  /** unit string was parsed and matched an existing unit by name/alias */
  | "matched"
  /** unit string was parsed but matched via the synonym map (e.g. tablespoon → EL) */
  | "synonym"
  /** no unit string parsed but a quantity was, so we defaulted to Stück */
  | "defaulted"
  /** parsed a unit token, didn't match anything */
  | "unresolved"
  /** neither a parsed unit nor a sensible default (e.g. "Salz nach Geschmack") */
  | "empty";

export type ImportedIngredient = {
  quantity: number | null;
  /** Best-effort resolved unit. `id` null when we couldn't match anything;
   *  the UI uses {@link unitMatch} + {@link rawUnit} to render appropriately. */
  unit: { id: number; name: string } | null;
  unitMatch: UnitMatch;
  /** The unit token the parser saw, when we couldn't resolve it. */
  rawUnit: string | null;
  name: string;
  /** id of an existing ingredient when the name matched (canonical or alias),
   *  null when it'll be created on save. */
  ingredientId: number | null;
  ingredientMatch: IngredientMatch;
  /** Canonical name of the matched ingredient — only set when the typed
   *  name differs from the canonical (i.e. we matched via an alias). */
  canonicalIngredientName: string | null;
  notes: string | null;
};

export type ImportedSection = {
  title: string | null;
  instructions: string;
  ingredients: ImportedIngredient[];
};

export type ImportedRecipe = {
  title: string;
  description: string | null;
  servings: number;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  sourceUrl: string;
  photoPath: string | null;
  tags: string[];
  sections: ImportedSection[];
};

export class ImportError extends Error {
  constructor(
    message: string,
    public readonly code: "fetch" | "parse" | "noRecipe" | "image",
  ) {
    super(message);
    this.name = "ImportError";
  }
}

/**
 * Synonyms that should map a parsed unit token to one of our canonical units.
 * Lookup is case-insensitive; the value is the canonical `unit.name` to fetch
 * from the DB. Anything not in here falls through to the alias table and then
 * to the "unresolved" path.
 */
const UNIT_SYNONYMS: Record<string, string> = {
  // tablespoon
  tablespoon: "EL",
  tablespoons: "EL",
  tbsp: "EL",
  tbs: "EL",
  esslöffel: "EL",
  eßlöffel: "EL",
  // teaspoon
  teaspoon: "TL",
  teaspoons: "TL",
  tsp: "TL",
  teelöffel: "TL",
  // cup
  cup: "Cup",
  cups: "Cup",
  tasse: "Cup",
  tassen: "Cup",
  // metric mass
  gram: "g",
  grams: "g",
  gramm: "g",
  kilogram: "kg",
  kilograms: "kg",
  kilogramm: "kg",
  milligram: "mg",
  milligrams: "mg",
  // metric volume
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  // imperial
  ounce: "oz",
  ounces: "oz",
  pound: "lb",
  pounds: "lb",
  lbs: "lb",
  "fluid ounce": "fl oz",
  "fluid ounces": "fl oz",
  "fl-oz": "fl oz",
  // counts
  piece: "Stück",
  pieces: "Stück",
  stk: "Stück",
  "stk.": "Stück",
  st: "Stück",
  stueck: "Stück",
  // pinch
  pinch: "Prise",
  prisen: "Prise",
  dash: "Prise",
  // can / bottle / etc.
  can: "Dose",
  cans: "Dose",
  dosen: "Dose",
  bottle: "Flasche",
  bottles: "Flasche",
  flaschen: "Flasche",
};

type UnitLookup = {
  byNameOrAlias: Map<string, { id: number; name: string }>;
  byCanonicalName: Map<string, { id: number; name: string }>;
};

function buildUnitLookup(): UnitLookup {
  const byNameOrAlias = new Map<string, { id: number; name: string }>();
  const byCanonicalName = new Map<string, { id: number; name: string }>();
  const canonical = db
    .select({ id: unit.id, name: unit.name })
    .from(unit)
    .all();
  for (const u of canonical) {
    const lower = u.name.toLowerCase();
    byNameOrAlias.set(lower, { id: u.id, name: u.name });
    byCanonicalName.set(lower, { id: u.id, name: u.name });
  }
  const aliases = db
    .select({
      id: unit.id,
      canonicalName: unit.name,
      aliasName: unitAlias.name,
    })
    .from(unitAlias)
    .innerJoin(unit, eq(unit.id, unitAlias.unitId))
    .all();
  for (const a of aliases) {
    const key = a.aliasName.toLowerCase();
    if (!byNameOrAlias.has(key)) {
      byNameOrAlias.set(key, { id: a.id, name: a.canonicalName });
    }
  }
  return { byNameOrAlias, byCanonicalName };
}

type ResolveUnitResult = {
  resolved: { id: number; name: string } | null;
  match: UnitMatch;
  rawUnit: string | null;
};

function resolveUnit(
  lookup: UnitLookup,
  rawUnitName: string | null,
  quantity: number | null,
): ResolveUnitResult {
  if (rawUnitName) {
    const key = rawUnitName.toLowerCase();
    const direct = lookup.byNameOrAlias.get(key);
    if (direct) {
      // Direct match: the imported token may still be a (case-insensitive)
      // alias that doesn't equal the canonical — surface it as `rawUnit`
      // so the UI can show the import-time spelling alongside the resolved
      // canonical (e.g. "Cups" → Cup).
      const rawUnit =
        rawUnitName.toLowerCase() === direct.name.toLowerCase()
          ? null
          : rawUnitName;
      return { resolved: direct, match: "matched", rawUnit };
    }

    const synonym = UNIT_SYNONYMS[key];
    if (synonym) {
      const viaSynonym = lookup.byCanonicalName.get(synonym.toLowerCase());
      if (viaSynonym) {
        return { resolved: viaSynonym, match: "synonym", rawUnit: rawUnitName };
      }
    }
    return { resolved: null, match: "unresolved", rawUnit: rawUnitName };
  }
  // No unit token. Default to Stück for "3 Eier"-style entries.
  if (quantity !== null && quantity > 0) {
    const stueck = lookup.byCanonicalName.get("stück");
    if (stueck) {
      return { resolved: stueck, match: "defaulted", rawUnit: null };
    }
  }
  return { resolved: null, match: "empty", rawUnit: null };
}

type IngredientLookupHit = { id: number; canonicalName: string };
type IngredientLookup = Map<string, IngredientLookupHit>;

function buildIngredientLookup(): IngredientLookup {
  const lookup: IngredientLookup = new Map();
  const canonical = db
    .select({ id: ingredient.id, name: ingredient.name })
    .from(ingredient)
    .all();
  for (const i of canonical) {
    lookup.set(i.name.toLowerCase(), { id: i.id, canonicalName: i.name });
  }
  const aliases = db
    .select({
      id: ingredient.id,
      canonicalName: ingredient.name,
      aliasName: ingredientAlias.name,
    })
    .from(ingredientAlias)
    .innerJoin(ingredient, eq(ingredient.id, ingredientAlias.ingredientId))
    .all();
  for (const a of aliases) {
    const key = a.aliasName.toLowerCase();
    if (!lookup.has(key)) {
      lookup.set(key, { id: a.id, canonicalName: a.canonicalName });
    }
  }
  return lookup;
}

function resolveIngredientName(
  lookup: IngredientLookup,
  rawName: string,
): {
  id: number | null;
  match: IngredientMatch;
  canonicalName: string | null;
} {
  const trimmed = rawName.trim();
  const key = trimmed.toLowerCase();
  const hit = lookup.get(key);
  if (hit === undefined) return { id: null, match: "new", canonicalName: null };
  // Only surface the canonical when it differs from what the user typed —
  // otherwise the pill would just echo the same word.
  const canonicalName =
    hit.canonicalName.toLowerCase() === key ? null : hit.canonicalName;
  return { id: hit.id, match: "existing", canonicalName };
}

void sql; // kept for future tuning; the import side reads everything via JS.

function instructionsToMarkdown(steps: string[]): string {
  if (steps.length === 0) return "";
  if (steps.length === 1) return steps[0];
  return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

function pickResolvedImageUrl(
  recipe: JsonLdRecipe,
  baseUrl: string,
): URL | null {
  const raw = asImageUrl(recipe.image);
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl);
  } catch {
    return null;
  }
}

async function downloadAndStoreImage(
  imgUrl: URL,
): Promise<PhotoPath | null> {
  try {
    const result = await fetchUrl(imgUrl.toString(), {
      accept: "image/*",
      timeoutMs: 20_000,
      // Allow a generous size since recipe hero photos can be large.
      maxBytes: 15 * 1024 * 1024,
    });
    return await savePhotoBuffer(result.body);
  } catch {
    // Failing to fetch the image shouldn't abort the whole import — the user
    // can attach a photo manually after.
    return null;
  }
}

function pickTags(recipe: JsonLdRecipe): string[] {
  const out = new Set<string>();
  const add = (raw: unknown) => {
    if (typeof raw === "string") {
      for (const t of raw.split(/[,;]/)) {
        const trimmed = t.trim();
        if (trimmed.length > 0 && trimmed.length <= 40) out.add(trimmed);
      }
    } else if (Array.isArray(raw)) {
      for (const r of raw) add(r);
    }
  };
  add(recipe.keywords);
  add(recipe.recipeCategory);
  add(recipe.recipeCuisine);
  return Array.from(out).slice(0, 12);
}

export async function importRecipeFromUrl(
  rawUrl: string,
): Promise<ImportedRecipe> {
  let fetched;
  try {
    fetched = await fetchUrl(rawUrl);
  } catch (e) {
    throw new ImportError(
      e instanceof FetchError ? e.message : "Seite konnte nicht geladen werden",
      "fetch",
    );
  }

  const html = fetched.body.toString("utf8");
  const recipe = extractJsonLdRecipe(html);
  if (!recipe) {
    throw new ImportError(
      "Keine maschinenlesbaren Rezeptdaten (schema.org/Recipe) gefunden.",
      "noRecipe",
    );
  }

  const title = asString(recipe.name) ?? "Importiertes Rezept";
  const description = asString(recipe.description);
  const servings = asServings(recipe.recipeYield);

  let prepTimeMin = parseIsoDurationToMinutes(recipe.prepTime);
  const cookTimeMin = parseIsoDurationToMinutes(recipe.cookTime);
  const totalTimeMin = parseIsoDurationToMinutes(recipe.totalTime);
  // If only totalTime is given, attribute it to prepTime so it shows up
  // somewhere; the user can re-distribute.
  if (prepTimeMin === null && cookTimeMin === null && totalTimeMin !== null) {
    prepTimeMin = totalTimeMin;
  }

  const ingredientStrings = asStringList(recipe.recipeIngredient);
  const unitLookup = buildUnitLookup();
  const ingredientLookup = buildIngredientLookup();
  const ingredients: ImportedIngredient[] = ingredientStrings.map((raw) => {
    const parsed = parseIngredientString(raw);
    const { resolved, match: unitMatch, rawUnit } = resolveUnit(
      unitLookup,
      parsed.unitName,
      parsed.quantity,
    );
    const name = parsed.name || raw.trim();
    const ingredientResolution = resolveIngredientName(ingredientLookup, name);
    return {
      quantity: parsed.quantity,
      unit: resolved,
      unitMatch,
      rawUnit,
      name,
      ingredientId: ingredientResolution.id,
      ingredientMatch: ingredientResolution.match,
      canonicalIngredientName: ingredientResolution.canonicalName,
      notes: parsed.notes,
    };
  });

  const instructions = instructionsToMarkdown(
    asStringList(recipe.recipeInstructions),
  );

  let photoPath: string | null = null;
  const imageUrl = pickResolvedImageUrl(recipe, fetched.url);
  if (imageUrl) {
    photoPath = await downloadAndStoreImage(imageUrl);
  }

  return {
    title,
    description,
    servings,
    prepTimeMin,
    cookTimeMin,
    sourceUrl: fetched.url,
    photoPath,
    tags: pickTags(recipe),
    sections: [
      {
        title: null,
        instructions,
        ingredients,
      },
    ],
  };
}
