"use client";

import * as React from "react";

import { useUrlBoolean } from "@/lib/url-state";

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
  const [unusedOnly, setUnusedOnly] = useUrlBoolean("unused");

  const searchMatches = React.useCallback(
    (item: TagItem, q: string) => item.name.toLowerCase().includes(q),
    [],
  );

  const applyFilters = React.useCallback(
    (item: TagItem) => {
      if (unusedOnly && item.recipeRefCount > 0) return false;
      return true;
    },
    [unusedOnly],
  );

  const filterControls = (
    <button
      type="button"
      onClick={() => setUnusedOnly(!unusedOnly)}
      className={
        "rounded-full border px-3 py-1 text-xs transition-colors " +
        (unusedOnly
          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
          : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
      }
    >
      Ungenutzt
    </button>
  );

  return (
    <ListShell<TagItem>
      entityKind="tag"
      initialItems={initialItems}
      columns={columns}
      idOf={(i) => i.id}
      nameOf={(i) => i.name}
      searchMatches={searchMatches}
      applyFilters={applyFilters}
      filterControls={filterControls}
      EditForm={TagForm}
      hardDeleteAllowed={true}
      mergeWarning={
        <>Die Namen der nicht ausgewählten Tags gehen verloren (Tags haben keine Aliase).</>
      }
    />
  );
}
