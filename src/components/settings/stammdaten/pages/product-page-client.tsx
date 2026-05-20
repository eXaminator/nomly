"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";

import { ProductForm, type ProductItem } from "../edit-forms/product-form";
import { ListShell, type ColumnDef } from "../list-shell";

const columns: ColumnDef<ProductItem>[] = [
  {
    key: "name",
    header: "Name",
    cell: (item) => <span className="font-medium">{item.name}</span>,
  },
  {
    key: "aliases",
    header: "Aliase",
    cell: (item) => {
      if (item.aliases.length === 0)
        return <span className="text-[var(--color-muted-fg)]">—</span>;
      const visible = item.aliases.slice(0, 3);
      const rest = item.aliases.length - visible.length;
      return (
        <span className="flex flex-wrap gap-1">
          {visible.map((a) => (
            <Badge key={a} variant="outline">
              {a}
            </Badge>
          ))}
          {rest > 0 && <Badge variant="outline">+{rest}</Badge>}
        </span>
      );
    },
  },
  {
    key: "category",
    header: "Kategorie",
    cell: (item) =>
      item.defaultCategoryName ? (
        <span>{item.defaultCategoryName}</span>
      ) : (
        <span className="text-[var(--color-muted-fg)]">—</span>
      ),
  },
  {
    key: "refs",
    header: "Verwendung",
    cell: (item) => (
      <span className="text-[var(--color-muted-fg)]">
        {item.shoppingItemRefCount} Einträge
      </span>
    ),
  },
];

export function ProductPageClient({
  initialItems,
}: {
  initialItems: ProductItem[];
}) {
  const searchMatches = React.useCallback((item: ProductItem, q: string) => {
    if (item.name.toLowerCase().includes(q)) return true;
    for (const a of item.aliases) {
      if (a.toLowerCase().includes(q)) return true;
    }
    return false;
  }, []);

  return (
    <ListShell<ProductItem>
      entityKind="product"
      initialItems={initialItems}
      columns={columns}
      idOf={(i) => i.id}
      nameOf={(i) => i.name}
      searchMatches={searchMatches}
      EditForm={ProductForm}
      hardDeleteAllowed={false}
      hardDeleteDisabledReason="Dieses Produkt steht noch auf einer Einkaufsliste — ein Ersatz-Produkt ist erforderlich."
    />
  );
}
