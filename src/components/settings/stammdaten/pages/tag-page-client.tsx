"use client";

import * as React from "react";

import { TagForm, type TagItem } from "../edit-forms/tag-form";
import { ListShell, type ColumnDef } from "../list-shell";

const columns: ColumnDef<TagItem>[] = [
  {
    key: "name",
    header: "Name",
    cell: (item) => <span className="font-medium">{item.name}</span>,
  },
  {
    key: "refs",
    header: "Verwendung",
    cell: (item) => (
      <span className="text-[var(--color-muted-fg)]">
        {item.recipeRefCount} Rezepte
      </span>
    ),
  },
];

export function TagPageClient({ initialItems }: { initialItems: TagItem[] }) {
  const searchMatches = React.useCallback(
    (item: TagItem, q: string) => item.name.toLowerCase().includes(q),
    [],
  );

  return (
    <ListShell<TagItem>
      entityKind="tag"
      initialItems={initialItems}
      columns={columns}
      idOf={(i) => i.id}
      nameOf={(i) => i.name}
      searchMatches={searchMatches}
      EditForm={TagForm}
      hardDeleteAllowed={true}
      mergeWarning={
        <>Die Namen der nicht ausgewählten Tags gehen verloren (Tags haben keine Aliase).</>
      }
    />
  );
}
