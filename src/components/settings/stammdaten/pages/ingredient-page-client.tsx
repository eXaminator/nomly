"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import { BulkIngredientDialog } from "../bulk-ingredient-dialog";
import {
  IngredientForm,
  type IngredientItem,
} from "../edit-forms/ingredient-form";
import { ListShell, type ColumnDef } from "../list-shell";

type DietFilter = "all" | "vegan" | "vegetarian" | "meat" | "unknown";

/**
 * Coarse category buckets used by the top-level filter chip row. Maps
 * raw `defaultCategoryName` strings to one of four user-facing groups.
 *   - Lebensmittel: any food/dairy/produce category (Tandoor's 22 + Hefeflocken
 *     / Backwaren / etc.)
 *   - Haushalt: cleaning supplies, personal-care, OTC medicine
 *   - Ausrüstung: items with `isEquipment=true` regardless of category
 *   - Alle: no filter
 */
type KindFilter = "all" | "food" | "household" | "equipment";

const HOUSEHOLD_CATEGORIES = new Set([
  "Hygiene",
  "Drogerie",
  "Haushalt",
  "Küchenbedarf",
]);

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
    key: "equipment",
    header: "Typ",
    cell: (item) =>
      item.isEquipment ? <Badge variant="outline">Ausrüstung</Badge> : null,
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
  const [kind, setKind] = React.useState<KindFilter>("all");
  const [diet, setDiet] = React.useState<DietFilter>("all");
  const [excludedOnly, setExcludedOnly] = React.useState(false);
  const [unusedOnly, setUnusedOnly] = React.useState(false);
  const [bulkDialog, setBulkDialog] = React.useState<{
    ids: number[];
    onApplied: () => void;
  } | null>(null);

  const applyFilters = React.useCallback(
    (item: IngredientItem) => {
      if (kind !== "all") {
        const isHousehold =
          item.defaultCategoryName != null &&
          HOUSEHOLD_CATEGORIES.has(item.defaultCategoryName);
        if (kind === "equipment" && !item.isEquipment) return false;
        if (kind === "household" && !isHousehold) return false;
        if (kind === "food" && (isHousehold || item.isEquipment)) return false;
      }
      if (diet !== "all") {
        if (diet === "unknown" && item.dietaryClass !== null) return false;
        if (diet !== "unknown" && item.dietaryClass !== diet) return false;
      }
      if (excludedOnly && !item.excludeFromShoppingList) return false;
      if (unusedOnly && item.recipeRefCount > 0) return false;
      return true;
    },
    [kind, diet, excludedOnly, unusedOnly],
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
        active={kind === "all"}
        onClick={() => setKind("all")}
        label="Alle"
      />
      <Chip
        active={kind === "food"}
        onClick={() => setKind("food")}
        label="Lebensmittel"
      />
      <Chip
        active={kind === "household"}
        onClick={() => setKind("household")}
        label="Haushalt"
      />
      <Chip
        active={kind === "equipment"}
        onClick={() => setKind("equipment")}
        label="Ausrüstung"
      />
      <span className="mx-2 h-5 w-px bg-[var(--color-border)]" />
      <Chip
        active={diet === "all"}
        onClick={() => setDiet("all")}
        label="Alle Diäten"
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
      <Chip
        active={unusedOnly}
        onClick={() => setUnusedOnly((v) => !v)}
        label="Ungenutzt"
      />
    </>
  );

  return (
    <>
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
        hardDeleteDisabledReason="Dieser Artikel wird in Rezepten oder Einkaufslisten verwendet — ein Ersatz-Artikel ist erforderlich."
        enableMergeProposals
        renderBulkActions={({ selectedIds, onApplied }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBulkDialog({ ids: selectedIds, onApplied })}
          >
            Bearbeiten
          </Button>
        )}
      />
      {bulkDialog ? (
        <BulkIngredientDialog
          open={true}
          selectedCount={bulkDialog.ids.length}
          selectedIds={bulkDialog.ids}
          onClose={() => setBulkDialog(null)}
          onApplied={bulkDialog.onApplied}
        />
      ) : null}
    </>
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
