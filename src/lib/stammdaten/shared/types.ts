import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import { db } from "../../../db/index.ts";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type EntityKind =
  | "ingredient"
  | "product"
  | "unit"
  | "category"
  | "tag"
  | "supermarket";

export type RefBreakdown = Record<string, number>;

export type RecipeIngredientUsage = {
  /** null when the row had no parsed quantity ("Salz nach Geschmack"). */
  quantity: number | null;
  /** Canonical unit name (e.g. "g", "EL"). Null when the row resolved to a
   *  sub-unit or carried no unit. */
  unitName: string | null;
  /** Ingredient-scoped sub-unit name when the row uses one (e.g. "Zehe"
   *  for Knoblauch). Mutually exclusive with {@link unitName}. */
  subUnitName: string | null;
  /** Override spelling when the source said e.g. "Tasse" but the row
   *  resolved to canonical unit "Cup". */
  displayUnit: string | null;
  /** Per-row name the recipe shows (e.g. "Tomaten" when the canonical is
   *  "Tomate"). Falls back to the canonical name when the row didn't
   *  override. */
  displayName: string | null;
  notes: string | null;
  isOptional: boolean;
  /** True for "Salz nach Geschmack" / "etwas Öl" rows — same flag the
   *  recipe view uses to render the lock icon. */
  fixedAmount: boolean;
};

export type RecipeLink = {
  id: number;
  title: string;
  /** Per-row usage details. Only populated for ingredient-context links
   *  (see {@link linkedRecipesForIngredients}); empty for unit / tag links. */
  usages?: RecipeIngredientUsage[];
};

export type ImpactRow = {
  id: number;
  refs: RefBreakdown;
  aliasCount: number;
  /** Concrete recipe references, when applicable (ingredient / tag / unit).
   * Empty for entities where there's no clean recipe link. Capped at the
   * service's per-entity limit. */
  linkedRecipes?: RecipeLink[];
};

/**
 * Simple bulk-update FK rewire: every loser-referencing row's FK column is
 * updated to the winner. Use this for FKs without a composite-uniqueness
 * constraint (the common case).
 */
export type FkRewire = {
  table: SQLiteTable;
  column: SQLiteColumn;
  /** Label for the impact-count breakdown (e.g. "recipes", "shoppingItems"). */
  refLabel: string;
};

export type MergeAdapter<Row> = {
  kind: EntityKind;
  table: SQLiteTable;
  idColumn: SQLiteColumn;
  nameColumn: SQLiteColumn;
  aliasTable: SQLiteTable | null;
  aliasParentColumn: SQLiteColumn | null;
  aliasNameColumn: SQLiteColumn | null;
  fkRewires: FkRewire[];
  /** Pre-flight validation across all selected rows. Returns error or null. */
  validate?: (rows: Row[]) => string | null;
  /**
   * Per-entity dedupe rewires for FKs with composite uniqueness (e.g.
   * `recipe_tag(recipe_id, tag_id)`, `supermarket_category(supermarket_id,
   * category_id)`). Runs inside the merge transaction, after the bulk
   * rewires in `fkRewires`. The adapter writes typed Drizzle queries against
   * the specific table — far easier than trying to express composite-PK
   * dedupe generically over column references.
   */
  customRewires?: (tx: Tx, winnerId: number, loserIds: number[]) => void;
  /** Hook called after FK rewires + before losers are deleted. */
  postProcess?: (tx: Tx, winner: Row, losers: Row[]) => void;
};
