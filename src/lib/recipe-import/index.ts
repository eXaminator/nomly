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
import {
  detectSectionHeader,
  normalizeForMatch,
  parseIngredientString,
  splitConjunctions,
} from "./ingredient.ts";
import { savePhotoBuffer, type PhotoPath } from "../photos.ts";

export type IngredientMatch = "existing" | "new";
export type UnitMatch =
  /** unit string was parsed and matched an existing unit by name or alias */
  | "matched"
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

export type UnitLookup = {
  byNameOrAlias: Map<string, { id: number; name: string }>;
  byCanonicalName: Map<string, { id: number; name: string }>;
};

export function buildUnitLookup(): UnitLookup {
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

export type ResolveUnitResult = {
  resolved: { id: number; name: string } | null;
  match: UnitMatch;
  rawUnit: string | null;
};

export function resolveUnit(
  lookup: UnitLookup,
  rawUnitName: string | null,
  quantity: number | null,
): ResolveUnitResult {
  if (rawUnitName) {
    const key = rawUnitName.toLowerCase();
    const direct = lookup.byNameOrAlias.get(key);
    if (direct) {
      // The imported token may still differ from the canonical (alias hit
      // or different casing/plural) — surface it as `rawUnit` so the UI can
      // show the import-time spelling alongside the resolved canonical
      // (e.g. "tablespoon" → EL, "Cups" → Cup).
      const rawUnit =
        rawUnitName.toLowerCase() === direct.name.toLowerCase()
          ? null
          : rawUnitName;
      return { resolved: direct, match: "matched", rawUnit };
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

export type IngredientLookupHit = { id: number; canonicalName: string };
export type IngredientLookup = Map<string, IngredientLookupHit>;

export function buildIngredientLookup(): IngredientLookup {
  const lookup: IngredientLookup = new Map();
  const canonical = db
    .select({ id: ingredient.id, name: ingredient.name })
    .from(ingredient)
    .all();
  // Two keys per row: the lowercase form AND the diacritic-stripped form.
  // The stripped form lets "Möhre" / "Moehre"-style inputs match the same
  // row when the user has only typed an ASCII-ish approximation. Lowercase
  // takes precedence (set first), so we never replace an existing exact
  // match with a different row's normalized hit.
  function add(key: string, hit: IngredientLookupHit) {
    if (!lookup.has(key)) lookup.set(key, hit);
  }
  for (const i of canonical) {
    const hit = { id: i.id, canonicalName: i.name };
    add(i.name.toLowerCase(), hit);
    add(normalizeForMatch(i.name), hit);
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
    const hit = { id: a.id, canonicalName: a.canonicalName };
    add(a.aliasName.toLowerCase(), hit);
    add(normalizeForMatch(a.aliasName), hit);
  }
  return lookup;
}

export function resolveIngredientName(
  lookup: IngredientLookup,
  rawName: string,
): {
  id: number | null;
  match: IngredientMatch;
  canonicalName: string | null;
} {
  const trimmed = rawName.trim();
  const key = trimmed.toLowerCase();
  // Try exact lowercase first, then fall back to the diacritic-stripped
  // form ("Möhre" → "mohre" → match).
  const hit = lookup.get(key) ?? lookup.get(normalizeForMatch(trimmed));
  if (hit === undefined) return { id: null, match: "new", canonicalName: null };
  const canonicalName =
    hit.canonicalName.toLowerCase() === key ? null : hit.canonicalName;
  return { id: hit.id, match: "existing", canonicalName };
}

void sql; // kept for future tuning; the import side reads everything via JS.

/**
 * Parse a batch of raw ingredient strings into the same shape `importRecipeFromUrl`
 * returns. Used by both the URL importer and the clipboard-paste endpoint.
 */
export function parseIngredientLines(
  lines: readonly string[],
  lookups: { units: UnitLookup; ingredients: IngredientLookup },
): ImportedIngredient[] {
  const knownUnitTokens = new Set(lookups.units.byNameOrAlias.keys());
  const out: ImportedIngredient[] = [];
  for (const raw of lines) {
    // Section headers (e.g. "Für den Teig:", "FÜR DIE FÜLLUNG") aren't
    // ingredients — section-aware callers use parseIngredientLinesIntoSections.
    if (detectSectionHeader(raw)) continue;
    for (const piece of splitConjunctions(raw)) {
      const parsed = parseIngredientString(piece, knownUnitTokens);
      const { resolved, match: unitMatch, rawUnit } = resolveUnit(
        lookups.units,
        parsed.unitName,
        parsed.quantity,
      );
      const name = parsed.name || piece.trim();
      const ingredientResolution = resolveIngredientName(
        lookups.ingredients,
        name,
      );
      out.push({
        quantity: parsed.quantity,
        unit: resolved,
        unitMatch,
        rawUnit,
        name,
        ingredientId: ingredientResolution.id,
        ingredientMatch: ingredientResolution.match,
        canonicalIngredientName: ingredientResolution.canonicalName,
        notes: parsed.notes,
      });
    }
  }
  return out;
}

export type ParsedSectionGroup = {
  /** Section title (null = the first/default unnamed section). */
  title: string | null;
  ingredients: ImportedIngredient[];
};

/**
 * Section-aware variant for the clipboard-paste flow: scans for section
 * headers (lines like "Für den Teig:", "FÜR DIE FÜLLUNG", "--- Sauce ---"),
 * splits ingredients into groups, and applies conjunction splitting inside
 * each group. The first group has `title: null` and collects any ingredients
 * that appear before the first header.
 */
export function parseIngredientLinesIntoSections(
  lines: readonly string[],
  lookups: { units: UnitLookup; ingredients: IngredientLookup },
): ParsedSectionGroup[] {
  const knownUnitTokens = new Set(lookups.units.byNameOrAlias.keys());
  const groups: ParsedSectionGroup[] = [{ title: null, ingredients: [] }];

  for (const raw of lines) {
    const header = detectSectionHeader(raw);
    if (header) {
      groups.push({ title: header, ingredients: [] });
      continue;
    }
    for (const piece of splitConjunctions(raw)) {
      const parsed = parseIngredientString(piece, knownUnitTokens);
      const { resolved, match: unitMatch, rawUnit } = resolveUnit(
        lookups.units,
        parsed.unitName,
        parsed.quantity,
      );
      const name = parsed.name || piece.trim();
      const ingredientResolution = resolveIngredientName(
        lookups.ingredients,
        name,
      );
      groups[groups.length - 1].ingredients.push({
        quantity: parsed.quantity,
        unit: resolved,
        unitMatch,
        rawUnit,
        name,
        ingredientId: ingredientResolution.id,
        ingredientMatch: ingredientResolution.match,
        canonicalIngredientName: ingredientResolution.canonicalName,
        notes: parsed.notes,
      });
    }
  }

  // Drop the leading unnamed section if empty — keeps the response clean
  // when the paste starts with a section header.
  if (groups.length > 1 && groups[0].title === null && groups[0].ingredients.length === 0) {
    groups.shift();
  }
  return groups;
}

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

export async function downloadAndStoreImage(
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
  const ingredients: ImportedIngredient[] = parseIngredientLines(
    ingredientStrings,
    { units: unitLookup, ingredients: ingredientLookup },
  );

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
