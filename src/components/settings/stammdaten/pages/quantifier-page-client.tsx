"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { useUrlBoolean } from "@/lib/url-state";

import {
  QuantifierForm,
  type QuantifierItem,
} from "../edit-forms/quantifier-form";
import { ListShell, type ColumnDef } from "../list-shell";

const columns: ColumnDef<QuantifierItem>[] = [
  {
    key: "name",
    header: "Name",
    cell: (item) => <span className="font-medium">{item.name}</span>,
    sortValue: (item) => item.name,
  },
  {
    key: "value",
    header: "Wert",
    cell: (item) =>
      item.value != null ? (
        <span className="tabular-nums">{item.value}</span>
      ) : (
        <span className="text-[var(--color-muted-fg)]">unbestimmt</span>
      ),
    sortValue: (item) => item.value,
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
    key: "refs",
    header: "Verwendung",
    cell: (item) => (
      <span className="text-[var(--color-muted-fg)]">
        {item.recipeRefCount} Rezepte
      </span>
    ),
    sortValue: (item) => item.recipeRefCount,
  },
];

export function QuantifierPageClient({
  initialItems,
}: {
  initialItems: QuantifierItem[];
}) {
  const [unusedOnly, setUnusedOnly] = useUrlBoolean("unused");

  const applyFilters = React.useCallback(
    (item: QuantifierItem) => {
      if (unusedOnly && item.recipeRefCount > 0) return false;
      return true;
    },
    [unusedOnly],
  );

  const searchMatches = React.useCallback((item: QuantifierItem, q: string) => {
    if (item.name.toLowerCase().includes(q)) return true;
    for (const a of item.aliases) {
      if (a.toLowerCase().includes(q)) return true;
    }
    return false;
  }, []);

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
    <ListShell<QuantifierItem>
      entityKind="quantifier"
      initialItems={initialItems}
      columns={columns}
      idOf={(i) => i.id}
      nameOf={(i) => i.name}
      applyFilters={applyFilters}
      searchMatches={searchMatches}
      filterControls={filterControls}
      EditForm={QuantifierForm}
      tallForm="edit"
      // recipe_ingredient.quantifier_id is ON DELETE RESTRICT — a referenced
      // quantifier can't be hard-deleted. The delete dialog disables
      // "Trotzdem löschen" and forces a replacement once impact.refs > 0.
      hardDeleteAllowed={false}
      hardDeleteDisabledReason="Mengenwörter, die in Rezepten verwendet werden, können nicht gelöscht werden. Bitte ein Ersatz-Mengenwort wählen."
    />
  );
}
