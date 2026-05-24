export type EntityKind =
  | "ingredient"
  | "product"
  | "unit"
  | "category"
  | "tag"
  | "supermarket";

export const ENTITY_LABELS: Record<
  EntityKind,
  { singular: string; plural: string; article: string }
> = {
  ingredient: { singular: "Zutat", plural: "Zutaten", article: "die" },
  product: { singular: "Produkt", plural: "Produkte", article: "das" },
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
  subUnitName: string | null;
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

export type ImpactRow = {
  id: number;
  refs: Record<string, number>;
  aliasCount: number;
  linkedRecipes?: RecipeLink[];
};

export const REF_LABELS: Record<string, string> = {
  recipes: "Rezepte",
  shoppingItems: "Einkaufslisten-Einträge",
  shoppingItemSources: "Mahlzeit-Beiträge",
  derivedUnits: "abgeleitete Einheiten",
  ingredients: "Zutaten",
  products: "Produkte",
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
