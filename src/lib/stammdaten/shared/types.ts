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

export type RecipeLink = {
  id: number;
  title: string;
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
