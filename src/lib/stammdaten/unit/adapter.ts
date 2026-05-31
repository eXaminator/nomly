import {
  recipeIngredient,
  shoppingItem,
  shoppingItemSource,
  unit,
  unitAlias,
} from "../../../db/schema.ts";
import type { MergeAdapter } from "../shared/types.ts";

export type UnitRow = {
  id: number;
  name: string;
  plural: string | null;
  dimension: "mass" | "volume" | "count";
  baseUnitId: number | null;
  factor: number;
};

export const unitAdapter: MergeAdapter<UnitRow> = {
  kind: "unit",
  table: unit,
  idColumn: unit.id,
  nameColumn: unit.name,
  aliasTable: unitAlias,
  aliasParentColumn: unitAlias.unitId,
  aliasNameColumn: unitAlias.name,
  // Carry plurals onto the winner when a unit is merged in: the loser unit's
  // own plural for its absorbed canonical name, and each loser alias's plural.
  aliasPluralColumn: unitAlias.plural,
  fkRewires: [
    {
      table: recipeIngredient,
      column: recipeIngredient.unitId,
      refLabel: "recipes",
    },
    {
      table: shoppingItem,
      column: shoppingItem.unitId,
      refLabel: "shoppingItems",
    },
    {
      table: shoppingItemSource,
      column: shoppingItemSource.contributedUnitId,
      refLabel: "shoppingItemSources",
    },
    {
      table: unit,
      column: unit.baseUnitId,
      refLabel: "derivedUnits",
    },
  ],
  validate: (rows) => {
    if (rows.length === 0) return null;
    const first = rows[0];
    for (const r of rows) {
      if (r.dimension !== first.dimension) {
        return `Merge nicht möglich: Die Einheiten "${first.name}" (${first.dimension}) und "${r.name}" (${r.dimension}) haben unterschiedliche Dimensionen.`;
      }
      if (r.factor !== first.factor) {
        return `Merge nicht möglich: Die Einheiten "${first.name}" (Faktor ${first.factor}) und "${r.name}" (Faktor ${r.factor}) haben unterschiedliche Faktoren. Falls eine Einheit aufgelöst werden soll, "Ersetzen und löschen" verwenden.`;
      }
    }
    return null;
  },
};
