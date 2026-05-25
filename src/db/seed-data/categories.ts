/**
 * Curated category seed — the canonical list of supermarket sections the
 * shopping list groups items by. Names are German (the app's primary
 * language); users can rename rows in the Stammdaten UI.
 *
 * Originally extracted from an external snapshot; now hand-edited and
 * checked into the repo as the single source of truth. App-specific
 * non-food categories (Hygiene, Drogerie, etc.) are layered on top via
 * `topUpCategories` in `src/db/seed.ts`.
 */
export type SeedCategory = {
  name: string;
  /** Free-text comment from the original Tandoor data — purely
   *  informational, not persisted. Kept here so future curators can see
   *  the intended scope of each category. */
  comment?: string;
};

export const SEED_CATEGORIES: SeedCategory[] = [
  { name: "Nudeln", comment: "All types of noodles" },
  { name: "Säfte" },
  { name: "Backwaren", comment: "Baked goods such as bread, toast, muffins." },
  { name: "Tiefkühl", comment: "All frozen food including pre-made and ice cream." },
  { name: "Konserven", comment: "All canned foods including vegetables, fruits and pre-made foods." },
  { name: "Aufstrich süß" },
  { name: "Süßigkeiten", comment: "All kinds of sweets, biscuits, chocolate, ..." },
  { name: "Kaffee und Tee", comment: "All kinds of coffee and tea products" },
  { name: "Aufstrich herzhaft" },
  { name: "Fisch und Meeresfrüchte", comment: "Fresh fish and other seafood." },
  { name: "Backen", comment: "Products used in baking like flour, sugar, baking powder." },
  { name: "Fleisch", comment: "Fresh meat such as ground beef, steak, chicken." },
  { name: "Trockenwaren" },
  { name: "Cerealien", comment: "All types of cereal including müsli and oatmeal." },
  { name: "Alkohol", comment: "For beer, wine and liquors used in cooking or baking." },
  { name: "Soßen", comment: "All condiments such as ketchup, mayo, mustard. Also includes sauces such as pesto rosso." },
  { name: "Molkereiprodukte", comment: "All milk products like milk, yoghurt, butter. But not cheese." },
  { name: "Essig und Öl", comment: "Includes all the different types of oils and vinegars." },
  { name: "Obst und Gemüse", comment: "Vegetables and fruits. Could be split into those categories." },
  { name: "Kühltheke", comment: "Cold cuts (of meat products such as sausage)" },
  { name: "Käse", comment: "Different kinds of cheeses such as parmigiano, mozzarella, or cheddar. Also includes grated cheeses." },
  { name: "Kräuter und Gewürze", comment: "Dried herbs and spices. Could include salt." },
];
