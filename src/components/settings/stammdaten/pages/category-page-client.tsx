"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";

import { CategoryForm, type CategoryItem } from "../edit-forms/category-form";
import { ListShell, type ColumnDef } from "../list-shell";

const columns: ColumnDef<CategoryItem>[] = [
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
    key: "usage",
    header: "Verwendung",
    cell: (item) => (
      <span className="text-[var(--color-muted-fg)]">
        {item.usageCount} Verwendungen
      </span>
    ),
  },
];

export function CategoryPageClient({
  initialItems,
}: {
  initialItems: CategoryItem[];
}) {
  const searchMatches = React.useCallback((item: CategoryItem, q: string) => {
    if (item.name.toLowerCase().includes(q)) return true;
    for (const a of item.aliases) {
      if (a.toLowerCase().includes(q)) return true;
    }
    return false;
  }, []);

  return (
    <ListShell<CategoryItem>
      entityKind="category"
      initialItems={initialItems}
      columns={columns}
      idOf={(i) => i.id}
      nameOf={(i) => i.name}
      searchMatches={searchMatches}
      EditForm={CategoryForm}
      hardDeleteAllowed={true}
    />
  );
}
