"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";
import { useUrlBoolean } from "@/lib/url-state";

import { BulkSupermarketCategoryDialog } from "../bulk-supermarket-category-dialog";
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
  const [unusedOnly, setUnusedOnly] = useUrlBoolean("unused");
  const [bulkDialog, setBulkDialog] = React.useState<{
    ids: number[];
    onApplied: () => void;
  } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function applyBulk(mode: "add" | "remove", supermarketIds: number[]) {
    if (!bulkDialog) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/categories/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: bulkDialog.ids,
          ...(mode === "add"
            ? { addToSupermarketIds: supermarketIds }
            : { removeFromSupermarketIds: supermarketIds }),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      bulkDialog.onApplied();
      setBulkDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  const searchMatches = React.useCallback((item: CategoryItem, q: string) => {
    if (item.name.toLowerCase().includes(q)) return true;
    for (const a of item.aliases) {
      if (a.toLowerCase().includes(q)) return true;
    }
    return false;
  }, []);

  const applyFilters = React.useCallback(
    (item: CategoryItem) => {
      if (unusedOnly && item.usageCount > 0) return false;
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
    <>
      <ListShell<CategoryItem>
        entityKind="category"
        initialItems={initialItems}
        columns={columns}
        idOf={(i) => i.id}
        nameOf={(i) => i.name}
        searchMatches={searchMatches}
        applyFilters={applyFilters}
        filterControls={filterControls}
        EditForm={CategoryForm}
        tallForm="edit"
        hardDeleteAllowed={true}
        renderBulkActions={({ selectedIds, onApplied }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setBulkDialog({ ids: selectedIds, onApplied });
              setError(null);
            }}
          >
            Supermärkte zuordnen
          </Button>
        )}
      />
      {bulkDialog ? (
        <BulkSupermarketCategoryDialog
          open={true}
          side={{
            pickedNoun: "Supermärkten",
            pickedNounSingular: "Supermarkt",
            searchEndpoint: "/api/v1/supermarkets/manage",
          }}
          selectionLabel={`${bulkDialog.ids.length} Kategorien ausgewählt`}
          saving={saving}
          error={error}
          onClose={() => {
            setBulkDialog(null);
            setError(null);
          }}
          onApply={applyBulk}
        />
      ) : null}
    </>
  );
}
