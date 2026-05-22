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
  type ParsedIngredient,
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
  /** True when the source line carried an "optional" marker ("opt.",
   *  "Optional:", "evtl.", "nach Belieben", "(optional)" inline, …). */
  isOptional: boolean;
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

export type UnitLookupEntry = {
  id: number;
  name: string;
  isContainer: boolean;
};
export type UnitLookup = {
  byNameOrAlias: Map<string, UnitLookupEntry>;
  byCanonicalName: Map<string, UnitLookupEntry>;
  /**
   * Lowercased tokens (canonical names + aliases) of units flagged as
   * containers. The parser uses this set to suppress conjunction-splitting
   * and prep-word stripping when a container is present.
   */
  containerTokens: Set<string>;
};

export function buildUnitLookup(): UnitLookup {
  const byNameOrAlias = new Map<string, UnitLookupEntry>();
  const byCanonicalName = new Map<string, UnitLookupEntry>();
  const containerTokens = new Set<string>();
  const canonical = db
    .select({
      id: unit.id,
      name: unit.name,
      isContainer: unit.isContainer,
    })
    .from(unit)
    .all();
  for (const u of canonical) {
    const lower = u.name.toLowerCase();
    const entry: UnitLookupEntry = {
      id: u.id,
      name: u.name,
      isContainer: u.isContainer,
    };
    byNameOrAlias.set(lower, entry);
    byCanonicalName.set(lower, entry);
    if (u.isContainer) containerTokens.add(lower);
  }
  const aliases = db
    .select({
      id: unit.id,
      canonicalName: unit.name,
      isContainer: unit.isContainer,
      aliasName: unitAlias.name,
    })
    .from(unitAlias)
    .innerJoin(unit, eq(unit.id, unitAlias.unitId))
    .all();
  for (const a of aliases) {
    const key = a.aliasName.toLowerCase();
    if (!byNameOrAlias.has(key)) {
      byNameOrAlias.set(key, {
        id: a.id,
        name: a.canonicalName,
        isContainer: a.isContainer,
      });
    }
    if (a.isContainer) containerTokens.add(key);
  }
  return { byNameOrAlias, byCanonicalName, containerTokens };
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
/**
 * Decide between the full parsed name and the prep-stripped alternative.
 * Rules:
 *   - container present in the line ⇒ use full name (no strip). The trailing
 *     adjective is part of the canned/jarred product name.
 *   - full name matches an existing ingredient/alias ⇒ use full name.
 *   - alternative available ⇒ use it (strip leading prep adjectives to notes).
 *   - otherwise ⇒ use full name unchanged.
 */
function pickNameAndNotes(
  rawLine: string,
  parsed: ParsedIngredient,
  ingredientLookup: IngredientLookup,
  containerTokens: ReadonlySet<string>,
): { name: string; notes: string | null } {
  const hasContainer = lineContainsToken(rawLine, containerTokens);
  if (hasContainer) {
    return { name: parsed.name, notes: parsed.notes };
  }
  const fullMatch = ingredientLookup.has(parsed.name.toLowerCase());
  if (fullMatch) {
    return { name: parsed.name, notes: parsed.notes };
  }
  if (parsed.altWithPrepStripped) {
    return parsed.altWithPrepStripped;
  }
  return { name: parsed.name, notes: parsed.notes };
}

function lineContainsToken(
  line: string,
  tokens: ReadonlySet<string>,
): boolean {
  if (tokens.size === 0) return false;
  const parts = line.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  for (const p of parts) {
    if (tokens.has(p)) return true;
  }
  return false;
}

export function parseIngredientLines(
  lines: readonly string[],
  lookups: { units: UnitLookup; ingredients: IngredientLookup },
): ImportedIngredient[] {
  const knownUnitTokens = new Set(lookups.units.byNameOrAlias.keys());
  const splitOpts = {
    containerTokens: lookups.units.containerTokens,
    knownIngredients: new Set(lookups.ingredients.keys()),
  };
  const out: ImportedIngredient[] = [];
  for (const raw of lines) {
    // Section headers (e.g. "Für den Teig:", "FÜR DIE FÜLLUNG") aren't
    // ingredients — section-aware callers use parseIngredientLinesIntoSections.
    if (detectSectionHeader(raw)) continue;
    // Skip pure-noise lines (no letters at all, e.g. "—–", "***").
    if (!/\p{L}/u.test(raw)) continue;
    for (const piece of splitConjunctions(raw, splitOpts)) {
      const parsed = parseIngredientString(piece, knownUnitTokens);
      // Skip the row when the parser couldn't pull a real ingredient name
      // out of the line. Familywall data legitimately has entries like
      // "2 Prise" / "200 g" / "5-7 EL" with no ingredient — there's nothing
      // useful to import, and falling back to the raw piece would create
      // a garbage row in the global ingredient catalog ("2 Prise" as an
      // ingredient). Same for fragments produced by conjunction splitting
      // that turn out to be empty.
      if (parsed.name.trim().length === 0) continue;
      // A leading "or X" / "oder X" almost always means we just split a
      // conjunction that connected alternatives. Attach as a note on the
      // previous row instead of creating a separate ingredient.
      const leadingOr = /^(?:or|oder)\s+(.+)/i.exec(parsed.name.trim());
      if (leadingOr && out.length > 0) {
        const alt = leadingOr[1];
        const prev = out[out.length - 1];
        prev.notes = prev.notes ? `${prev.notes}, oder ${alt}` : `oder ${alt}`;
        if (parsed.isOptional) prev.isOptional = true;
        continue;
      }
      const { resolved, match: unitMatch, rawUnit } = resolveUnit(
        lookups.units,
        parsed.unitName,
        parsed.quantity,
      );
      const { name, notes } = pickNameAndNotes(
        piece,
        parsed,
        lookups.ingredients,
        lookups.units.containerTokens,
      );
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
        notes,
        isOptional: parsed.isOptional,
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
  const splitOpts = {
    containerTokens: lookups.units.containerTokens,
    knownIngredients: new Set(lookups.ingredients.keys()),
  };
  const groups: ParsedSectionGroup[] = [{ title: null, ingredients: [] }];

  for (const raw of lines) {
    const header = detectSectionHeader(raw);
    if (header) {
      groups.push({ title: header, ingredients: [] });
      continue;
    }
    if (!/\p{L}/u.test(raw)) continue;
    for (const piece of splitConjunctions(raw, splitOpts)) {
      const parsed = parseIngredientString(piece, knownUnitTokens);
      if (parsed.name.trim().length === 0) continue;
      const currentGroup = groups[groups.length - 1];
      const leadingOr = /^(?:or|oder)\s+(.+)/i.exec(parsed.name.trim());
      if (leadingOr && currentGroup.ingredients.length > 0) {
        const alt = leadingOr[1];
        const prev = currentGroup.ingredients[currentGroup.ingredients.length - 1];
        prev.notes = prev.notes ? `${prev.notes}, oder ${alt}` : `oder ${alt}`;
        if (parsed.isOptional) prev.isOptional = true;
        continue;
      }
      const { resolved, match: unitMatch, rawUnit } = resolveUnit(
        lookups.units,
        parsed.unitName,
        parsed.quantity,
      );
      const { name, notes } = pickNameAndNotes(
        piece,
        parsed,
        lookups.ingredients,
        lookups.units.containerTokens,
      );
      const ingredientResolution = resolveIngredientName(
        lookups.ingredients,
        name,
      );
      currentGroup.ingredients.push({
        quantity: parsed.quantity,
        unit: resolved,
        unitMatch,
        rawUnit,
        name,
        ingredientId: ingredientResolution.id,
        ingredientMatch: ingredientResolution.match,
        canonicalIngredientName: ingredientResolution.canonicalName,
        notes,
        isOptional: parsed.isOptional,
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

export type ParsedInstructionGroup = {
  title: string | null;
  lines: string[];
};

/**
 * Split a list of instruction steps into groups by section header
 * ("Für den Teig:", "FÜR DIE FÜLLUNG", "Part 1: Sauce"). Mirrors the
 * ingredient-side splitter so titles match by string identity and the
 * caller can pair them up section-by-section.
 */
export function parseInstructionsIntoSections(
  lines: readonly string[],
): ParsedInstructionGroup[] {
  const groups: ParsedInstructionGroup[] = [{ title: null, lines: [] }];
  for (const raw of lines) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const header = detectSectionHeader(trimmed);
    if (header) {
      groups.push({ title: header, lines: [] });
      continue;
    }
    groups[groups.length - 1].lines.push(trimmed);
  }
  if (groups.length > 1 && groups[0].title === null && groups[0].lines.length === 0) {
    groups.shift();
  }
  return groups;
}

/**
 * Match instruction groups to ingredient groups by title (case- and
 * diacritic-insensitive) and emit per-section instructions. Instruction
 * groups without a matching ingredient title become their own
 * ingredient-less section. Leading unnamed instructions get attached to
 * the first ingredient section so a recipe that starts with a prep step
 * and then has "Für den Teig:" still gets all instructions in the right
 * order.
 *
 * `joinFn` controls how step lines are rendered into the section's
 * instructions string (each importer can format differently — Familywall
 * uses numbered ordered-list markdown, URL imports keep the source's
 * structure).
 */
export function mergeIngredientAndInstructionSections(
  ingredientGroups: readonly ParsedSectionGroup[],
  instructionGroups: readonly ParsedInstructionGroup[],
  joinFn: (lines: string[]) => string,
): Array<{
  title: string | null;
  ingredients: ImportedIngredient[];
  instructions: string;
}> {
  function keyOf(t: string | null): string | null {
    return t == null ? null : normalizeForMatch(t);
  }

  const remaining = new Map<string | null, string[]>();
  // When multiple instruction groups share a normalized title (rare), the
  // first wins; the rest accumulate into the same key so nothing is lost.
  for (const g of instructionGroups) {
    const k = keyOf(g.title);
    const existing = remaining.get(k);
    if (existing) existing.push(...g.lines);
    else remaining.set(k, [...g.lines]);
  }

  const merged: Array<{
    title: string | null;
    ingredients: ImportedIngredient[];
    instructions: string;
  }> = [];
  for (const ig of ingredientGroups) {
    const k = keyOf(ig.title);
    const lines = remaining.get(k);
    if (lines) remaining.delete(k);
    merged.push({
      title: ig.title,
      ingredients: ig.ingredients,
      instructions: joinFn(lines ?? []),
    });
  }

  // Instructions whose title didn't match any ingredient section.
  // Attach unnamed leftovers to the first section's instructions
  // (prepend) so they read in document order. Named leftovers become
  // their own sections with empty ingredients.
  for (const [k, lines] of remaining) {
    if (lines.length === 0) continue;
    if (k === null) {
      if (merged.length === 0) {
        merged.push({ title: null, ingredients: [], instructions: joinFn(lines) });
      } else {
        const head = merged[0];
        head.instructions = [joinFn(lines), head.instructions]
          .filter((s) => s.length > 0)
          .join("\n");
      }
      continue;
    }
    const originalTitle =
      instructionGroups.find((g) => keyOf(g.title) === k)?.title ?? null;
    merged.push({
      title: originalTitle,
      ingredients: [],
      instructions: joinFn(lines),
    });
  }
  return merged;
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

  // Section-aware: ingredients and instructions both get split on shared
  // section headers ("Für den Teig:", "FÜR DIE FÜLLUNG"). Matching titles
  // land in the same merged section. Unmatched leftovers either prepend
  // to the first section (unnamed lead-in) or become their own ingredient-
  // less sections (named).
  const ingredientGroups = parseIngredientLinesIntoSections(ingredientStrings, {
    units: unitLookup,
    ingredients: ingredientLookup,
  });
  const instructionGroups = parseInstructionsIntoSections(
    asStringList(recipe.recipeInstructions),
  );
  const merged = mergeIngredientAndInstructionSections(
    ingredientGroups,
    instructionGroups,
    instructionsToMarkdown,
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
    sections:
      merged.length > 0
        ? merged
        : [{ title: null, instructions: "", ingredients: [] }],
  };
}
