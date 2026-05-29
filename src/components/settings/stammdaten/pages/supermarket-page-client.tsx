"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";

import { BulkSupermarketCategoryDialog } from "../bulk-supermarket-category-dialog";
import {
  SupermarketForm,
  type SupermarketItem,
} from "../edit-forms/supermarket-form";
import { ListShell, type ColumnDef } from "../list-shell";

const columns: ColumnDef<SupermarketItem>[] = [
  {
    key: "id",
    header: "ID",
    // Surfaced so it can be wired into external integrations (e.g. the Home
    // Assistant geofence automation maps a zone to this supermarket id).
    cell: (item) => (
      <span className="font-mono tabular-nums text-[var(--color-muted-fg)]">
        {item.id}
      </span>
    ),
    sortValue: (item) => item.id,
    className: "w-16",
  },
  {
    key: "name",
    header: "Name",
    cell: (item) => <span className="font-medium">{item.name}</span>,
    sortValue: (item) => item.name,
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
  const [bulkDialog, setBulkDialog] = React.useState<{
    ids: number[];
    onApplied: () => void;
  } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function applyBulk(mode: "add" | "remove", categoryIds: number[]) {
    if (!bulkDialog) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/supermarkets/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: bulkDialog.ids,
          ...(mode === "add"
            ? { addCategoryIds: categoryIds }
            : { removeCategoryIds: categoryIds }),
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

  return (
    <>
      <ListShell<SupermarketItem>
        entityKind="supermarket"
        initialItems={initialItems}
        columns={columns}
        initialSort={{ key: "name", dir: "asc" }}
        idOf={(i) => i.id}
        nameOf={(i) => i.name}
        searchMatches={searchMatches}
        EditForm={SupermarketForm}
        hardDeleteAllowed={true}
        mergeWarning={
          <>
            Supermärkte zusammenzuführen ist ungewöhnlich. Bei Konflikten in
            der Kategorienreihenfolge gewinnt der ausgewählte Supermarkt.
          </>
        }
        renderBulkActions={({ selectedIds, onApplied }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setBulkDialog({ ids: selectedIds, onApplied });
              setError(null);
            }}
          >
            Kategorien zuordnen
          </Button>
        )}
      />
      {bulkDialog ? (
        <BulkSupermarketCategoryDialog
          open={true}
          side={{
            pickedNoun: "Kategorien",
            pickedNounSingular: "Kategorie",
            searchEndpoint: "/api/v1/categories/manage",
          }}
          selectionLabel={`${bulkDialog.ids.length} Supermärkte ausgewählt`}
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
