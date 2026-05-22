import {
  ingredient,
  ingredientAlias,
  recipeIngredient,
  shoppingItem,
} from "../../../db/schema.ts";
import type { MergeAdapter } from "../shared/types.ts";

export type IngredientRow = {
  id: number;
  name: string;
  defaultCategoryId: number | null;
  excludeFromShoppingList: boolean;
  dietaryClass: "vegan" | "vegetarian" | "meat" | null;
  createdAt: number;
  updatedAt: number;
};

export const ingredientAdapter: MergeAdapter<IngredientRow> = {
  kind: "ingredient",
  table: ingredient,
  idColumn: ingredient.id,
  nameColumn: ingredient.name,
  aliasTable: ingredientAlias,
  aliasParentColumn: ingredientAlias.ingredientId,
  aliasNameColumn: ingredientAlias.name,
  fkRewires: [
    {
      table: recipeIngredient,
      column: recipeIngredient.ingredientId,
      refLabel: "recipes",
    },
    {
      table: shoppingItem,
      column: shoppingItem.ingredientId,
      refLabel: "shoppingItems",
    },
  ],
};
