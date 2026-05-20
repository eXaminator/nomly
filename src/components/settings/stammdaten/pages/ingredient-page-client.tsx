"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";

import {
  IngredientForm,
  type IngredientItem,
} from "../edit-forms/ingredient-form";
import { ListShell, type ColumnDef } from "../list-shell";

type DietFilter = "all" | "vegan" | "vegetarian" | "meat" | "unknown";

const DIET_LABEL: Record<NonNullable<IngredientItem["dietaryClass"]>, string> = {
  vegan: "Vegan",
  vegetarian: "Veg.",
  meat: "Tierisch",
};

const DIET_VARIANT: Record<
  NonNullable<IngredientItem["dietaryClass"]>,
  "success" | "warning" | "danger"
> = {
  vegan: "success",
  vegetarian: "warning",
  meat: "danger",
};

const columns: ColumnDef<IngredientItem>[] = [
  {
    key: "name",
    header: "Name",
    cell: (item) => <span className="font-medium">{item.name}</span>,
  },
  {
    key: "aliases",
    header: "Aliase",
    cell: (item) => {
      if (item.aliases.length === 0) {
        return <span className="text-[var(--color-muted-fg)]">—</span>;
      }
      const visible = item.aliases.slice(0, 3);
      const rest = item.aliases.length - visible.length;
      return (
        <span className="flex flex-wrap gap-1">
          {visible.map((alias) => (
            <Badge key={alias} variant="outline">
              {alias}
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
    key: "diet",
    header: "Diät",
    cell: (item) =>
      item.dietaryClass ? (
        <Badge variant={DIET_VARIANT[item.dietaryClass]}>
          {DIET_LABEL[item.dietaryClass]}
        </Badge>
      ) : (
        <span className="text-[var(--color-muted-fg)]">—</span>
      ),
  },
  {
    key: "exclude",
    header: "Liste",
    cell: (item) =>
      item.excludeFromShoppingList ? (
        <Badge variant="outline">ausgeschlossen</Badge>
      ) : null,
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

export function IngredientPageClient({
  initialItems,
}: {
  initialItems: IngredientItem[];
}) {
  const [diet, setDiet] = React.useState<DietFilter>("all");
  const [excludedOnly, setExcludedOnly] = React.useState(false);

  const applyFilters = React.useCallback(
    (item: IngredientItem) => {
      if (diet !== "all") {
        if (diet === "unknown" && item.dietaryClass !== null) return false;
        if (diet !== "unknown" && item.dietaryClass !== diet) return false;
      }
      if (excludedOnly && !item.excludeFromShoppingList) return false;
      return true;
    },
    [diet, excludedOnly],
  );

  const searchMatches = React.useCallback(
    (item: IngredientItem, q: string) => {
      if (item.name.toLowerCase().includes(q)) return true;
      for (const a of item.aliases) {
        if (a.toLowerCase().includes(q)) return true;
      }
      return false;
    },
    [],
  );

  const filterControls = (
    <>
      <Chip
        active={diet === "all"}
        onClick={() => setDiet("all")}
        label="Alle"
      />
      <Chip
        active={diet === "vegan"}
        onClick={() => setDiet("vegan")}
        label="Vegan"
      />
      <Chip
        active={diet === "vegetarian"}
        onClick={() => setDiet("vegetarian")}
        label="Vegetarisch"
      />
      <Chip
        active={diet === "meat"}
        onClick={() => setDiet("meat")}
        label="Tierisch"
      />
      <Chip
        active={diet === "unknown"}
        onClick={() => setDiet("unknown")}
        label="Unbekannt"
      />
      <span className="mx-2 h-5 w-px bg-[var(--color-border)]" />
      <Chip
        active={excludedOnly}
        onClick={() => setExcludedOnly((v) => !v)}
        label="Ausgeschlossen"
      />
    </>
  );

  return (
    <ListShell<IngredientItem>
      entityKind="ingredient"
      initialItems={initialItems}
      columns={columns}
      idOf={(i) => i.id}
      nameOf={(i) => i.name}
      applyFilters={applyFilters}
      searchMatches={searchMatches}
      filterControls={filterControls}
      EditForm={IngredientForm}
      hardDeleteAllowed={false}
      hardDeleteDisabledReason="Diese Zutat wird in Rezepten oder Einkaufslisten verwendet — eine Ersatz-Zutat ist erforderlich."
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
