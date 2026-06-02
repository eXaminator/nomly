export type EntityKind =
  | "ingredient"
  | "unit"
  | "category"
  | "tag"
  | "supermarket";

export const ENTITY_LABELS: Record<
  EntityKind,
  { singular: string; plural: string; article: string }
> = {
  ingredient: { singular: "Artikel", plural: "Artikel", article: "der" },
  unit: { singular: "Einheit", plural: "Einheiten", article: "die" },
  category: { singular: "Kategorie", plural: "Kategorien", article: "die" },
  tag: { singular: "Tag", plural: "Tags", article: "der" },
  supermarket: {
    singular: "Supermarkt",
    plural: "Supermärkte",
    article: "der",
  },
};

export type RecipeIngredientUsage = {
  quantity: number | null;
  unitName: string | null;
  displayUnit: string | null;
  displayName: string | null;
  notes: string | null;
  isOptional: boolean;
  fixedAmount: boolean;
};

export type RecipeLink = {
  id: number;
  title: string;
  usages?: RecipeIngredientUsage[];
};

/** A per-ingredient conversion edge referencing a unit (`1 from = factor × to`). */
export type ConversionUsage = {
  fromUnitName: string;
  toUnitName: string;
  factor: number;
  isContainer: boolean;
};

/** An article whose unit conversions reference a unit — shown in that unit's
 *  reference tab. */
export type IngredientConversionLink = {
  id: number;
  name: string;
  conversions: ConversionUsage[];
};

/** A plain reference to another core-data row (id + display name). */
export type EntityRef = {
  id: number;
  name: string;
};

export type ImpactRow = {
  id: number;
  refs: Record<string, number>;
  aliasCount: number;
  linkedRecipes?: RecipeLink[];
  linkedIngredients?: IngredientConversionLink[];
  linkedDerivedUnits?: EntityRef[];
  linkedCategoryIngredients?: EntityRef[];
  linkedCategorySupermarkets?: EntityRef[];
};

export const REF_LABELS: Record<string, string> = {
  recipes: "Rezepte",
  shoppingItems: "Einkaufslisten-Einträge",
  shoppingItemSources: "Mahlzeit-Beiträge",
  derivedUnits: "abgeleitete Einheiten",
  ingredients: "Artikel",
  supermarketCategoryEntries: "Supermarkt-Einträge",
  categoryEntries: "geordnete Kategorien",
};

export function formatRefs(refs: Record<string, number>): string {
  const parts: string[] = [];
  for (const [key, count] of Object.entries(refs)) {
    if (count <= 0) continue;
    const label = REF_LABELS[key] ?? key;
    parts.push(`${count} ${label}`);
  }
  return parts.length === 0 ? "Keine Referenzen" : parts.join(", ");
}

export function refsSum(refs: Record<string, number>): number {
  let n = 0;
  for (const v of Object.values(refs)) n += Number(v) || 0;
  return n;
}
