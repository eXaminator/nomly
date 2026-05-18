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
 * Render the step list as a markdown ordered list. Always uses `1.`, `2.`,
 * … even when there's a single step — that way the rendered recipe shows
 * the same structure regardless of how many steps Familywall had, and the
 * markdown editor parses it as a proper ordered list.
 */
function joinInstructions(steps: string[]): string {
  const cleaned = steps
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
  if (cleaned.length === 0) return "";
  return cleaned.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

const FAVORITE_TAG = "Familywall-Favorit";

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
  const ingredients = raw.ingredients
    .map((line) => parseIngredientString(line))
    .map((parsed) => {
      const fallbackName = parsed.name.trim();
      const name =
        fallbackName.length > 0
          ? fallbackName
          : "Unbekannte Zutat";
      const { resolved, rawUnit } = resolveUnit(
        lookups.units,
        parsed.unitName,
        parsed.quantity,
      );
      // Unresolved unit tokens get appended to notes so the user can still
      // see what Familywall had — same trick the URL importer uses.
      const noteParts = [
        parsed.notes,
        rawUnit && !resolved ? `Einheit: ${rawUnit}` : null,
      ].filter((p): p is string => typeof p === "string" && p.length > 0);
      // resolveIngredientName is informational here — `createRecipe` will
      // do its own case-insensitive resolution when it inserts. We don't
      // need to pass the resolved id, just the name string.
      void resolveIngredientName(lookups.ingredients, name);
      return {
        ingredientName: name,
        quantity: parsed.quantity,
        unitId: resolved ? resolved.id : null,
        notes: noteParts.length > 0 ? noteParts.join(" – ") : null,
      };
    });

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
    sections: [
      {
        title: null,
        instructions: joinInstructions(raw.instructions),
        ingredients,
      },
    ],
  };
}
