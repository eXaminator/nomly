export type RecipeIngredientInput = {
  /** Freeform ingredient name. The service resolves it case-insensitively
   *  against existing ingredient/alias names and inserts a new ingredient
   *  if nothing matches. */
  ingredientName: string;
  quantity: number | null;
  unitId: number | null;
  notes: string | null;
  isOptional: boolean;
};

export type RecipeSectionInput = {
  title: string | null;
  instructions: string;
  ingredients: RecipeIngredientInput[];
};

export type RecipeInput = {
  title: string;
  description: string | null;
  servings: number;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  sourceUrl: string | null;
  /** Path produced by /api/v1/photos (e.g. "photos/<uuid>.webp"). */
  photoPath: string | null;
  tags: string[];
  sections: RecipeSectionInput[];
};

/**
 * Wrapper around RecipeInput that allows the API to resolve a freeform
 * image URL into a photoPath before persisting. The route fetches the URL
 * via the standard photo pipeline (download → re-encode as webp), then hands
 * a normal RecipeInput off to the service layer.
 */
export type RecipeApiInput = RecipeInput & {
  /** Image URL the server should download on save. When set, it overrides
   *  `photoPath` after the download succeeds. */
  photoUrl?: string | null;
};

export type RecipeListItem = {
  id: number;
  title: string;
  description: string | null;
  photoPath: string | null;
  servings: number;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  tags: string[];
  /** Derived from non-optional ingredients' dietary_class. `null` = unknown. */
  isVegan: boolean | null;
  isVegetarian: boolean | null;
};

export type RecipeIngredientView = {
  id: number;
  ingredientId: number;
  /** Whatever the user picked or typed at save time (recipe_ingredient.
   *  display_name OR ingredient.name fallback). */
  ingredientName: string;
  /** ingredient.name — the canonical row. May be the same string as
   *  ingredientName; the UI hides the badge in that case. */
  canonicalIngredientName: string;
  quantity: number | null;
  unitId: number | null;
  unitName: string | null;
  notes: string | null;
  isOptional: boolean;
  sortOrder: number;
};

export type RecipeSectionView = {
  id: number;
  title: string | null;
  instructions: string;
  sortOrder: number;
  ingredients: RecipeIngredientView[];
};

export type RecipeView = {
  id: number;
  title: string;
  description: string | null;
  photoPath: string | null;
  sourceUrl: string | null;
  servings: number;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  tags: string[];
  sections: RecipeSectionView[];
  /** Derived from non-optional ingredients' dietary_class. `null` = unknown. */
  isVegan: boolean | null;
  isVegetarian: boolean | null;
  createdAt: number;
  updatedAt: number;
};
