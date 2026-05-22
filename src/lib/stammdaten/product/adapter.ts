import { product, productAlias, shoppingItem } from "../../../db/schema.ts";
import type { MergeAdapter } from "../shared/types.ts";

export type ProductRow = {
  id: number;
  name: string;
  defaultCategoryId: number | null;
  createdAt: number;
  updatedAt: number;
};

export const productAdapter: MergeAdapter<ProductRow> = {
  kind: "product",
  table: product,
  idColumn: product.id,
  nameColumn: product.name,
  aliasTable: productAlias,
  aliasParentColumn: productAlias.productId,
  aliasNameColumn: productAlias.name,
  fkRewires: [
    {
      table: shoppingItem,
      column: shoppingItem.productId,
      refLabel: "shoppingItems",
    },
  ],
};
