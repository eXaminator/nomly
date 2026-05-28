"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";
import { useUrlBoolean, useUrlString } from "@/lib/url-state";

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

// Stable lexical ranking for dietary class: vegan < vegetarisch < tierisch.
// Unknown (null) lands at the end via compareSortValues's null-sink rule.
const DIET_RANK: Record<NonNullable<IngredientItem["dietaryClass"]>, number> = {
  vegan: 0,
  vegetarian: 1,
  meat: 2,
};

const columns: ColumnDef<IngredientItem>[] = [
  {
    key: "name",
    header: "Name",
    cell: (item) => <span className="font-medium">{item.name}</span>,
    sortValue: (item) => item.name,
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
    sortValue: (item) => item.aliases.length,
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
    sortValue: (item) => item.defaultCategoryName,
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
    sortValue: (item) => (item.dietaryClass ? DIET_RANK[item.dietaryClass] : null),
  },
  {
    key: "equipment",
    header: "Typ",
    cell: (item) =>
      item.isEquipment ? <Badge variant="outline">Ausrüstung</Badge> : null,
    sortValue: (item) => item.isEquipment,
  },
  {
    key: "exclude",
    header: "Liste",
    cell: (item) =>
      item.excludeFromShoppingList ? (
        <Badge variant="outline">ausgeschlossen</Badge>
      ) : null,
    sortValue: (item) => item.excludeFromShoppingList,
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

const NO_CATEGORY_VALUE = "__none__";

export function IngredientPageClient({
  initialItems,
}: {
  initialItems: IngredientItem[];
}) {
  // Filter state lives in the URL so reload / back-navigation preserves it.
  // Default values are stripped from the URL, so the canonical address is
  // just /einstellungen/zutaten until the user actually narrows the list.
  const [kind, setKind] = useUrlString<KindFilter>("kind", "all");
  const [diet, setDiet] = useUrlString<DietFilter>("diet", "all");
  /** "" = no filter; NO_CATEGORY_VALUE = match rows with NULL category;
   *  otherwise the category name to match exactly. */
  const [categoryFilter, setCategoryFilter] = useUrlString<string>("cat", "");
  const [excludedOnly, setExcludedOnly] = useUrlBoolean("excluded");
  const [unusedOnly, setUnusedOnly] = useUrlBoolean("unused");

  // Build the category dropdown options from the items currently in scope.
  // Sorted by German locale so the select reads naturally; "no category"
  // is appended at the end as a sentinel option.
  const categoryOptions = React.useMemo(() => {
    const names = new Set<string>();
    let anyMissing = false;
    for (const item of initialItems) {
      if (item.defaultCategoryName) names.add(item.defaultCategoryName);
      else anyMissing = true;
    }
    const sorted = Array.from(names).sort((a, b) =>
      a.localeCompare(b, "de", { sensitivity: "base" }),
    );
    return { names: sorted, anyMissing };
  }, [initialItems]);
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
      if (categoryFilter) {
        if (categoryFilter === NO_CATEGORY_VALUE) {
          if (item.defaultCategoryName !== null) return false;
        } else if (item.defaultCategoryName !== categoryFilter) {
          return false;
        }
      }
      if (diet !== "all") {
        if (diet === "unknown" && item.dietaryClass !== null) return false;
        if (diet !== "unknown" && item.dietaryClass !== diet) return false;
      }
      if (excludedOnly && !item.excludeFromShoppingList) return false;
      if (unusedOnly && item.recipeRefCount > 0) return false;
      return true;
    },
    [kind, diet, categoryFilter, excludedOnly, unusedOnly],
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
      <FilterSelect
        label="Typ"
        value={kind}
        onChange={(v) => setKind(v as KindFilter)}
        options={[
          { value: "all", label: "Alle" },
          { value: "food", label: "Lebensmittel" },
          { value: "household", label: "Haushalt" },
          { value: "equipment", label: "Ausrüstung" },
        ]}
      />
      <FilterSelect
        label="Kategorie"
        value={categoryFilter}
        onChange={setCategoryFilter}
        options={[
          { value: "", label: "Alle Kategorien" },
          ...(categoryOptions.anyMissing
            ? [{ value: NO_CATEGORY_VALUE, label: "Ohne Kategorie" }]
            : []),
          ...categoryOptions.names.map((name) => ({ value: name, label: name })),
        ]}
      />
      <FilterSelect
        label="Diät"
        value={diet}
        onChange={(v) => setDiet(v as DietFilter)}
        options={[
          { value: "all", label: "Alle Diäten" },
          { value: "vegan", label: "Vegan" },
          { value: "vegetarian", label: "Vegetarisch" },
          { value: "meat", label: "Tierisch" },
          { value: "unknown", label: "Unbekannt" },
        ]}
      />
      <span className="mx-1 h-5 w-px bg-[var(--color-border)]" />
      <Chip
        active={excludedOnly}
        onClick={() => setExcludedOnly(!excludedOnly)}
        label="Ausgeschlossen"
      />
      <Chip
        active={unusedOnly}
        onClick={() => setUnusedOnly(!unusedOnly)}
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

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-[var(--color-muted-fg)]">
      <span>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-xs text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
