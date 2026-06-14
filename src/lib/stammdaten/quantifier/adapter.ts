import {
  quantifier,
  quantifierAlias,
  recipeIngredient,
} from "../../../db/schema.ts";
import type { MergeAdapter } from "../shared/types.ts";

export type QuantifierRow = {
  id: number;
  name: string;
  value: number | null;
  sortOrder: number;
};

export const quantifierAdapter: MergeAdapter<QuantifierRow> = {
  kind: "quantifier",
  table: quantifier,
  idColumn: quantifier.id,
  nameColumn: quantifier.name,
  aliasTable: quantifierAlias,
  aliasParentColumn: quantifierAlias.quantifierId,
  aliasNameColumn: quantifierAlias.name,
  // Quantifier aliases carry no plural — leave aliasPluralColumn undefined.
  fkRewires: [
    {
      table: recipeIngredient,
      column: recipeIngredient.quantifierId,
      refLabel: "recipes",
    },
  ],
  // Quantifier values don't constrain a merge (unlike unit dimension/factor):
  // merging two quantifiers is purely a name/alias consolidation, so no
  // validate hook.
};
