export type RecipeIngredientInput = {
  /** Freeform ingredient name. Surfaces as `display_name` on the persisted
   *  row. When {@link ingredientId} is null/omitted, the server uses this
   *  to look up an existing ingredient by case-insensitive canonical/alias
   *  match — and creates a new ingredient row if nothing matches. */
  ingredientName: string;
  /** Optional pre-resolved ingredient id, chosen via the pill UI in the
   *  recipe form. When set, the server links the row directly to this
   *  ingredient (skipping name-based resolution) and `ingredientName` is
   *  preserved verbatim as the per-row display name. */
  ingredientId?: number | null;
  /** When set, the server inserts the row's `ingredientName` as an alias
   *  of {@link ingredientId} (force-match flow). Ignored when
   *  `ingredientId` is null. */
  addAsAlias?: boolean;
  quantity: number | null;
  unitId: number | null;
  /** Ingredient-scoped sub-unit reference. Mutually exclusive with
   *  `unitId`: when set, `unitId` must be null and the quantity is in this
   *  sub-unit. */
  subUnitId: number | null;
  /** Display override for the unit — used when the user picked / typed an
   *  alias ("Tasse") for a canonical unit ("Cup"). NULL = render the
   *  canonical unit name as before. */
  displayUnit: string | null;
  notes: string | null;
  isOptional: boolean;
  /** When true, the quantity does not scale with planned servings. */
  fixedAmount: boolean;
  /** Original source substring this row was parsed from. The URL importer
   *  and Familywall importer thread this through so the edit form can show
   *  the user the line the parser was working from. Null/omitted for
   *  manually-added rows. */
  rawLine?: string | null;
};

export type RecipeSectionInput = {
  title: string | null;
  instructions: string;
  ingredients: RecipeIngredientInput[];
};

/**
 * Defaults to apply when the recipe save creates a new ingredient row. Keyed
 * by the ingredient name (matched case-insensitively against the submitted
 * `ingredientName`). Names that already exist as canonical/alias are ignored.
 */
export type NewIngredientDefaults = {
  name: string;
  defaultCategoryId: number | null;
  dietaryClass: "vegan" | "vegetarian" | "meat" | null;
  excludeFromShoppingList: boolean;
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
  /** Optional. Per-name defaults applied when the save inserts a new
   *  ingredient row. */
  newIngredientDefaults?: NewIngredientDefaults[];
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
  /** display_unit OR unit.name fallback OR sub-unit name (coalesced
   *  server-side, in that order of preference). */
  unitName: string | null;
  /** Set when the row was saved with an ingredient sub-unit instead of a
   *  global unit. Surfaced for downstream conversion (shopping-list rollup). */
  subUnitId: number | null;
  /** How many sub-units make one purchase unit, for shopping aggregation.
   *  Only meaningful when `subUnitId` is set. */
  subUnitPerPurchase: number | null;
  notes: string | null;
  isOptional: boolean;
  /** When true, this quantity is constant — meal-plan portion changes do not
   *  rescale it. */
  fixedAmount: boolean;
  /** Source substring this row was originally parsed from. Null for rows
   *  added manually after the initial import. */
  rawLine: string | null;
  /** Mirror of `ingredient.is_equipment`. The recipe view groups these into
   *  a separate "Du brauchst auch" sub-section so cookware/consumables
   *  don't visually compete with food ingredients. */
  isEquipment: boolean;
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
