import type { DietConfidence, IngredientDietaryClass } from "./diet.ts";

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
  /** "Nicht zugeordnet": the row is free text that doesn't map to any
   *  article. The server persists `ingredient_id` NULL (no article looked up
   *  or created) with the text in `display_name`, and the line never reaches
   *  a shopping list. Forces `ingredientId` to null.
   *  Defaults to false. */
  unassigned?: boolean;
  quantity: number | null;
  /** Low bound of a structured amount range, else null. Optional/back-compat:
   *  omitted = no range (single amount). */
  quantityLow?: number | null;
  /** Reference to a configured quantifier ("zwei", "einige"). When set, the
   *  row's amount is the quantifier (resolved via {@link effectiveQuantity});
   *  `quantity`/`quantityLow` MUST be null. Mutually exclusive with a literal
   *  quantity — never both. Optional/back-compat: omitted = no quantifier. */
  quantifierId?: number | null;
  unitId: number | null;
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
  /** When true, this row is an ALTERNATIVE to the most recent
   *  non-alternative row in the same section. The server resolves this
   *  flag to a non-null `recipe_ingredient.alternative_for_id` at insert
   *  time. Alternatives are always persisted as optional, regardless of
   *  what {@link isOptional} carries. Defaults to false. */
  isAlternative?: boolean;
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
  isEquipment: boolean;
  /** Advanced "enrich the article" fields, mirroring the full catalog editor.
   *  All optional with empty defaults so the minimal create path stays valid.
   *  Persisted via {@link createIngredientCore} when the save inserts the row. */
  aliases?: string[];
  aliasUnitDefaults?: Array<{
    aliasName: string;
    unitId: number | null;
    unitDisplay: string | null;
  }>;
  aliasDisplayNames?: Record<string, string>;
  conversions?: Array<{
    fromUnitId: number;
    toUnitId: number;
    factor: number;
    isContainer: boolean;
  }>;
  defaultUnitId?: number | null;
  defaultUnitDisplay?: string | null;
  excludedSupermarketIds?: number[];
};

/**
 * Non-fatal outcome of an explicit "add as alias" request during a recipe
 * save. `canonical`: the spelling is another ingredient's canonical name —
 * the alias was NOT created (canonical lookup would always shadow it).
 * `collision`: the spelling is already an alias of other ingredient(s) — the
 * alias WAS created anyway (cross-ingredient collisions are a legal, curated
 * state; see the ingredient_alias schema notes) and is reported so the user
 * can curate it.
 */
export type AliasWarning = {
  aliasName: string;
  kind: "canonical" | "collision";
  otherIngredientNames: string[];
  created: boolean;
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
  /** "definite" vs "probable" — drives the "Wahrscheinlich …" badge tier. */
  dietConfidence: DietConfidence;
  /** User flag: this recipe is marked for a later edit. Drives the card
   *  badge and the "Update nötig" list filter. */
  needsUpdate: boolean;
  /** Whether the CURRENT viewer has favorited this recipe. */
  isFavorite: boolean;
};

/** Subset of {@link RecipeListItem} the meal planner ships to the browser.
 *  The planner's recipe panel and drag preview only render the title, photo,
 *  tags and diet badge, and `servings` seeds default portions; the recipe
 *  preview dialog re-fetches full details by id. Dropping `description` and
 *  the prep/cook times keeps the planner's per-navigation payload small. */
export type PlannerRecipe = Pick<
  RecipeListItem,
  | "id"
  | "title"
  | "photoPath"
  | "servings"
  | "tags"
  | "isVegan"
  | "isVegetarian"
  | "dietConfidence"
>;

export type RecipeIngredientView = {
  id: number;
  /** NULL for "Nicht zugeordnet" lines — free text not linked to any
   *  article (see {@link RecipeIngredientInput.unassigned}). */
  ingredientId: number | null;
  /** Whatever the user picked or typed at save time (recipe_ingredient.
   *  display_name OR ingredient.name fallback). For unassigned lines this is
   *  the row's only text. */
  ingredientName: string;
  /** ingredient.name — the canonical row. May be the same string as
   *  ingredientName; the UI hides the badge in that case. NULL for
   *  unassigned lines (no canonical article). */
  canonicalIngredientName: string | null;
  quantity: number | null;
  /** Low bound of a structured amount range, else null. High bound is in
   *  {@link quantity}. */
  quantityLow: number | null;
  /** Reference to the configured quantifier this row's amount uses, else null.
   *  When set, {@link quantity}/{@link quantityLow} are null and the effective
   *  number is {@link quantifierValue}. */
  quantifierId: number | null;
  /** Canonical name of the referenced quantifier ("zwei", "einige"), else null. */
  quantifierName: string | null;
  /** Numeric value of the referenced quantifier — may be null for an
   *  unspecified quantifier like "einige". Null when no quantifier is set. */
  quantifierValue: number | null;
  unitId: number | null;
  /** display_unit OR unit.name fallback (coalesced server-side, in that order
   *  of preference). This is the *raw* matched label as stored — the recipe
   *  editor round-trips it. For display, prefer {@link unitLabel}, which
   *  applies the configured plural by amount. */
  unitName: string | null;
  /** The label to *show* for this line: the matched unit/alias rendered in
   *  its singular or plural form depending on {@link quantity} (plural for any
   *  amount other than 1, when one is configured). Falls back to the singular
   *  / raw spelling when no plural applies. */
  unitLabel: string | null;
  /** When true, this line's unit is flagged for fraction display, so the read
   *  view renders the quantity as a fraction ("1/4 TL") when it resolves to
   *  one, decimal otherwise. */
  displayFraction: boolean;
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
  /** Mirror of `ingredient.dietary_class`. Drives the per-ingredient diet
   *  marker on the recipe detail page. NULL = no marker (unknown). */
  dietaryClass: IngredientDietaryClass;
  sortOrder: number;
  /** Non-null when this row is an alternative for another ingredient in the
   *  same section — points at that primary's {@link id}. Null on primary
   *  rows. Alternatives sort immediately after their primary and are
   *  always {@link isOptional}. */
  alternativeForId: number | null;
  /** All accrued spellings for this ingredient (ingredient_alias.name plus any
   *  non-empty display_name renames). Empty for unassigned lines. Used to
   *  highlight ingredient mentions in the section instructions even when the
   *  cooking step uses a different spelling than the list row. */
  aliases: string[];
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
  dietConfidence: DietConfidence;
  /** User flag: this recipe is marked for a later edit. */
  needsUpdate: boolean;
  /** Whether the CURRENT viewer has favorited this recipe. */
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
};
