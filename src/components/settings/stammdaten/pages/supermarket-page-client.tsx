"use client";

import * as React from "react";

import {
  SupermarketForm,
  type SupermarketItem,
} from "../edit-forms/supermarket-form";
import { ListShell, type ColumnDef } from "../list-shell";

const columns: ColumnDef<SupermarketItem>[] = [
  {
    key: "name",
    header: "Name",
    cell: (item) => <span className="font-medium">{item.name}</span>,
  },
  {
    key: "ordered",
    header: "Kategorien-Reihenfolge",
    cell: (item) => (
      <span className="text-[var(--color-muted-fg)]">
        {item.orderedCategoryCount} Kategorien geordnet
      </span>
    ),
  },
];

export function SupermarketPageClient({
  initialItems,
}: {
  initialItems: SupermarketItem[];
}) {
  const searchMatches = React.useCallback(
    (item: SupermarketItem, q: string) => item.name.toLowerCase().includes(q),
    [],
  );

  return (
    <ListShell<SupermarketItem>
      entityKind="supermarket"
      initialItems={initialItems}
      columns={columns}
      idOf={(i) => i.id}
      nameOf={(i) => i.name}
      searchMatches={searchMatches}
      EditForm={SupermarketForm}
      hardDeleteAllowed={true}
      mergeWarning={
        <>
          Supermärkte zusammenzuführen ist ungewöhnlich. Bei Konflikten in der
          Kategorienreihenfolge gewinnt der ausgewählte Supermarkt.
        </>
      }
    />
  );
}
