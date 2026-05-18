import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { unit, unitAlias } from "../../db/schema.ts";
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

export type ImportedIngredient = {
  quantity: number | null;
  /** Resolved canonical unit (case-insensitive on name + alias). null when
   *  the parsed unit token didn't match anything we have. */
  unit: { id: number; name: string } | null;
  name: string;
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
 * Cache the unit table for the lifetime of one import call. The list is tiny
 * (~14 rows seeded) and we look up every ingredient against it.
 */
function buildUnitLookup(): Map<string, { id: number; name: string }> {
  const lookup = new Map<string, { id: number; name: string }>();
  const canonical = db
    .select({ id: unit.id, name: unit.name })
    .from(unit)
    .all();
  for (const u of canonical) {
    lookup.set(u.name.toLowerCase(), { id: u.id, name: u.name });
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
    if (!lookup.has(key)) {
      lookup.set(key, { id: a.id, name: a.canonicalName });
    }
  }
  return lookup;
}

function resolveUnit(
  lookup: Map<string, { id: number; name: string }>,
  rawUnitName: string | null,
): { resolved: { id: number; name: string } | null; unresolvedToken: string | null } {
  if (!rawUnitName) return { resolved: null, unresolvedToken: null };
  const key = rawUnitName.toLowerCase();
  const hit = lookup.get(key);
  if (hit) return { resolved: hit, unresolvedToken: null };
  return { resolved: null, unresolvedToken: rawUnitName };
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
  const ingredients: ImportedIngredient[] = ingredientStrings.map((raw) => {
    const parsed = parseIngredientString(raw);
    const { resolved, unresolvedToken } = resolveUnit(unitLookup, parsed.unitName);
    // If a unit token was parsed but didn't resolve, append it to notes so
    // the user can still see what the source said.
    const notesParts = [unresolvedToken, parsed.notes].filter(
      (n): n is string => typeof n === "string" && n.length > 0,
    );
    return {
      quantity: parsed.quantity,
      unit: resolved,
      name: parsed.name || raw.trim(),
      notes: notesParts.join(" – ") || null,
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
