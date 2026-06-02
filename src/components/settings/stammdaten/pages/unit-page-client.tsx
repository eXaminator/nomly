"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { useUrlBoolean, useUrlString } from "@/lib/url-state";

import {
  UnitForm,
  type Dimension,
  type UnitItem,
} from "../edit-forms/unit-form";
import { ListShell, type ColumnDef } from "../list-shell";

type DimensionFilter = "all" | Dimension;

const DIMENSION_LABEL: Record<Dimension, string> = {
  mass: "Masse",
  volume: "Volumen",
  count: "Stück",
};

const columns: ColumnDef<UnitItem>[] = [
  {
    key: "name",
    header: "Name",
    cell: (item) => (
      <span className="font-medium">
        {item.name}
        {item.plural && (
          <span className="font-normal text-[var(--color-muted-fg)]">
            {" "}
            / {item.plural}
          </span>
        )}
      </span>
    ),
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
          {visible.map((a) => {
            const plural = item.aliasPlurals[a];
            return (
              <Badge key={a} variant="outline">
                {plural ? `${a} / ${plural}` : a}
              </Badge>
            );
          })}
          {rest > 0 && <Badge variant="outline">+{rest}</Badge>}
        </span>
      );
    },
  },
  {
    key: "dimension",
    header: "Dimension",
    cell: (item) => (
      <span className="inline-flex items-center gap-1">
        <Badge variant="outline">{DIMENSION_LABEL[item.dimension]}</Badge>
        {item.isContainer && <Badge variant="accent">Behälter</Badge>}
      </span>
    ),
  },
  {
    key: "baseUnit",
    header: "Basis-Einheit",
    cell: (item) =>
      item.baseUnitName ? (
        <span>{item.baseUnitName}</span>
      ) : (
        <span className="text-[var(--color-muted-fg)]">—</span>
      ),
  },
  {
    key: "factor",
    header: "Faktor",
    cell: (item) => <span className="tabular-nums">{item.factor}</span>,
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

export function UnitPageClient({
  initialItems,
}: {
  initialItems: UnitItem[];
}) {
  const [dimension, setDimension] = useUrlString<DimensionFilter>("dim", "all");
  const [unusedOnly, setUnusedOnly] = useUrlBoolean("unused");

  const applyFilters = React.useCallback(
    (item: UnitItem) => {
      if (dimension !== "all" && item.dimension !== dimension) return false;
      if (unusedOnly && item.recipeRefCount > 0) return false;
      return true;
    },
    [dimension, unusedOnly],
  );

  const searchMatches = React.useCallback((item: UnitItem, q: string) => {
    if (item.name.toLowerCase().includes(q)) return true;
    for (const a of item.aliases) {
      if (a.toLowerCase().includes(q)) return true;
    }
    return false;
  }, []);

  const filterControls = (
    <>
      <Chip
        active={dimension === "all"}
        onClick={() => setDimension("all")}
        label="Alle"
      />
      <Chip
        active={dimension === "mass"}
        onClick={() => setDimension("mass")}
        label="Masse"
      />
      <Chip
        active={dimension === "volume"}
        onClick={() => setDimension("volume")}
        label="Volumen"
      />
      <Chip
        active={dimension === "count"}
        onClick={() => setDimension("count")}
        label="Stück"
      />
      <span className="mx-2 h-5 w-px bg-[var(--color-border)]" />
      <Chip
        active={unusedOnly}
        onClick={() => setUnusedOnly(!unusedOnly)}
        label="Ungenutzt"
      />
    </>
  );

  return (
    <ListShell<UnitItem>
      entityKind="unit"
      initialItems={initialItems}
      columns={columns}
      idOf={(i) => i.id}
      nameOf={(i) => i.name}
      applyFilters={applyFilters}
      searchMatches={searchMatches}
      filterControls={filterControls}
      EditForm={UnitForm}
      tallForm="edit"
      hardDeleteAllowed={true}
    />
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full border px-3 py-1 text-xs transition-colors " +
        (active
          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
          : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
      }
    >
      {label}
    </button>
  );
}
