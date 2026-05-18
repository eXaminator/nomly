"use client";

import { RecipeForm } from "./recipe-form";

type Props = {
  tagSuggestions: string[];
};

/**
 * Thin client wrapper around the recipe form. URL import lives at
 * /rezepte/importieren as its own page; this component intentionally stays
 * minimal so the manual-entry path doesn't accumulate import-specific UX.
 */
export function NewRecipeForm({ tagSuggestions }: Props) {
  return <RecipeForm tagSuggestions={tagSuggestions} />;
}
