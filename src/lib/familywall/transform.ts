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

import {
  mergeIngredientAndInstructionSections,
  parseIngredientLinesIntoSections,
  parseInstructionsIntoSections,
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

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1));
}

/**
 * Familywall often emits all-caps section titles ("PASTRY", "FILLING") that
 * read better as title-case ("Pastry", "Filling"). Mixed-case titles like
 * "Für den Teig" the user typed themselves are left untouched.
 */
function prettifySectionTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed === trimmed.toLocaleUpperCase("de") ? toTitleCase(trimmed) : trimmed;
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
  // Same pipeline as the clipboard-paste and URL-import flows: section
  // header detection (`:`-ending, all-caps, leading dashes/emoji),
  // conjunction splitting ("Salz und Pfeffer" → 2 rows), and the full
  // parseIngredientString with all its noise-stripping + amount-parsing
  // heuristics. Familywall imports get the same treatment as any other
  // source.
  const ingredientGroups = parseIngredientLinesIntoSections(
    raw.ingredients,
    lookups,
  );
  // Instructions can carry their own section headers ("Für den Teig:" then
  // the steps for the dough). Parse them with the same header detector so
  // matching titles end up in the same merged section.
  const instructionGroups = parseInstructionsIntoSections(raw.instructions);

  const merged = mergeIngredientAndInstructionSections(
    ingredientGroups,
    instructionGroups,
    joinInstructions,
  );

  const sections = merged.map((m) => ({
    title: m.title ? prettifySectionTitle(m.title) : null,
    instructions: m.instructions,
    ingredients: m.ingredients.map((p) => {
      const name = p.name.trim().length > 0 ? p.name.trim() : "Unbekannte Zutat";
      const noteParts = [
        p.notes,
        p.rawUnit && !p.unit ? `Einheit: ${p.rawUnit}` : null,
      ].filter((s): s is string => typeof s === "string" && s.length > 0);
      return {
        ingredientName: name,
        quantity: p.quantity,
        unitId: p.unit ? p.unit.id : null,
        notes: noteParts.length > 0 ? noteParts.join(" – ") : null,
        isOptional: p.isOptional,
      };
    }),
  }));

  // Guarantee at least one section even when the source had zero ingredients —
  // RecipeInput callers expect `sections[0]` to exist.
  if (sections.length === 0) {
    sections.push({
      title: null,
      instructions: joinInstructions(raw.instructions),
      ingredients: [],
    });
  }

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
