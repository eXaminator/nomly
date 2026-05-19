/**
 * Pure transformation: one {@link FamilywallRawRecipe} → one `RecipeInput`
 * that `createRecipe` accepts. No DB writes, no HTTP, no photos.
 *
 * The orchestrator is responsible for:
 *   - building the unit + ingredient lookup maps once
 *   - downloading + storing the photo (so `photoPath` is set when passed in)
 *
 * Anything that can't be resolved is left null/empty rather than guessed —
 * we trust the existing `createRecipe` flow to auto-create ingredients and
 * tolerate missing units/notes.
 */

import { parseIngredientString } from "../recipe-import/ingredient.ts";
import {
  resolveIngredientName,
  resolveUnit,
  type IngredientLookup,
  type UnitLookup,
} from "../recipe-import/index.ts";
import type { RecipeInput } from "../recipes/types.ts";
import type { FamilywallRawRecipe } from "./types.ts";

/**
 * Strip any existing leading step-number marker from a single step, so we
 * don't double-number ("1. Heat oil" + our "1. " prefix → "1. 1. Heat oil").
 * Recognises:
 *   "1." / "1)" / "1:" — bare numeric marker
 *   "Step 1." / "Schritt 1:" — labelled marker
 * The marker must be followed by whitespace, which keeps real content like
 * "1.5 cups" / "1 minute later" from being eaten.
 */
function stripStepNumber(s: string): string {
  return s.replace(/^\s*(?:step\s+|schritt\s+)?\d+\s*[.):\]]+\s+/i, "");
}

/**
 * Render the step list as a markdown ordered list. Always uses `1.`, `2.`,
 * … even when there's a single step — that way the rendered recipe shows
 * the same structure regardless of how many steps Familywall had, and the
 * markdown editor parses it as a proper ordered list.
 */
function joinInstructions(steps: string[]): string {
  const cleaned = steps
    .map((s) => s.replace(/\s+/g, " ").trim())
    .map(stripStepNumber)
    .filter((s) => s.length > 0);
  if (cleaned.length === 0) return "";
  return cleaned.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

const FAVORITE_TAG = "Familywall-Favorit";

/**
 * A bare line of all-uppercase text (no digits, no commas) is treated as a
 * section heading rather than an ingredient — typical pattern in scraped
 * recipes that split the ingredient list into PASTRY / FILLING / GLAZE.
 */
function isSectionHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 2) return false;
  if (!/\p{L}/u.test(trimmed)) return false;
  if (/[\d,;()/]/.test(trimmed)) return false;
  return trimmed === trimmed.toUpperCase();
}

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1));
}

/**
 * Split raw ingredient lines into one-or-more sections at every all-caps
 * heading. The heading (title-cased) becomes the section title; lines
 * between headings are that section's ingredients.
 */
function splitIngredientsBySection(
  lines: string[],
): Array<{ title: string | null; ingredients: string[] }> {
  const sections: Array<{ title: string | null; ingredients: string[] }> = [];
  let cur: { title: string | null; ingredients: string[] } = {
    title: null,
    ingredients: [],
  };
  for (const line of lines) {
    if (isSectionHeading(line)) {
      if (cur.ingredients.length > 0) sections.push(cur);
      cur = { title: toTitleCase(line.trim()), ingredients: [] };
    } else {
      cur.ingredients.push(line);
    }
  }
  if (cur.ingredients.length > 0 || cur.title !== null) sections.push(cur);
  if (sections.length === 0) sections.push({ title: null, ingredients: [] });
  return sections;
}

function dedupeTags(tags: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const trimmed = t.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function transformFamilywallRecipe(
  raw: FamilywallRawRecipe,
  lookups: { units: UnitLookup; ingredients: IngredientLookup },
  /** Photo path the orchestrator stored before calling us, or null. */
  photoPath: string | null,
): RecipeInput {
  // Derive the parser's known-unit set from the DB. Adding a new alias to
  // unit_alias is now the single source of truth — no parser-side patch
  // required.
  const knownUnitTokens = new Set(lookups.units.byNameOrAlias.keys());
  function parseLine(line: string) {
    const parsed = parseIngredientString(line, knownUnitTokens);
    const fallbackName = parsed.name.trim();
    const name = fallbackName.length > 0 ? fallbackName : "Unbekannte Zutat";
    const { resolved, rawUnit } = resolveUnit(
      lookups.units,
      parsed.unitName,
      parsed.quantity,
    );
    const noteParts = [
      parsed.notes,
      rawUnit && !resolved ? `Einheit: ${rawUnit}` : null,
    ].filter((p): p is string => typeof p === "string" && p.length > 0);
    // resolveIngredientName is informational here — `createRecipe` does its
    // own case-insensitive resolution when it inserts.
    void resolveIngredientName(lookups.ingredients, name);
    return {
      ingredientName: name,
      quantity: parsed.quantity,
      unitId: resolved ? resolved.id : null,
      notes: noteParts.length > 0 ? noteParts.join(" – ") : null,
    };
  }

  const sectionRaw = splitIngredientsBySection(raw.ingredients);
  // Instructions describe the whole recipe; Familywall doesn't split them
  // per-section, so they stay on the first section.
  const sections = sectionRaw.map((section, idx) => ({
    title: section.title,
    instructions: idx === 0 ? joinInstructions(raw.instructions) : "",
    ingredients: section.ingredients.map(parseLine),
  }));

  return {
    title: raw.title.trim() || "Importiertes Rezept",
    description: raw.description?.trim() || null,
    servings: raw.servings && raw.servings > 0 ? Math.round(raw.servings) : 1,
    prepTimeMin: raw.prepTimeMin,
    cookTimeMin: raw.cookTimeMin,
    // The user explicitly asked: never store a link back to Familywall. Only
    // the recipe's own original source URL (which Familywall may carry as a
    // separate field) is allowed here.
    sourceUrl: raw.sourceUrl?.trim() || null,
    photoPath,
    tags: dedupeTags([
      ...raw.tags,
      ...(raw.isFavorite ? [FAVORITE_TAG] : []),
    ]),
    sections,
  };
}
