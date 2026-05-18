/**
 * Raw recipe shape produced by the Familywall crawler. Strings are still
 * unparsed — the {@link transform} step converts these to a `RecipeInput`
 * ready for `createRecipe`.
 */
export type FamilywallRawRecipe = {
  /** Display title from the Familywall card. */
  title: string;
  /** Optional free-form description / intro paragraph. */
  description: string | null;
  /** Numeric servings — null when Familywall doesn't expose it. */
  servings: number | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  /** Raw ingredient lines, one per item, as the crawler scraped them. */
  ingredients: string[];
  /** Step-by-step instructions, one entry per step. The transform joins
   *  them as a numbered markdown list. */
  instructions: string[];
  /** Original source URL Familywall has on file — pointing at where the
   *  user saved the recipe FROM, NOT a Familywall page. Null when missing
   *  or when the user typed the recipe directly into Familywall. */
  sourceUrl: string | null;
  /** Optional photo URL — resolved later by the orchestrator (which has
   *  the Playwright context's cookies for authenticated CDN fetches). */
  imageUrl: string | null;
};

export type FamilywallImportSummary = {
  imported: number;
  skipped: number;
  failed: number;
  details: Array<{
    title: string;
    outcome: "imported" | "skipped" | "failed";
    /** Set on "imported" outcomes. */
    recipeId?: number;
    /** Set on "failed" outcomes — short message. */
    error?: string;
  }>;
};
