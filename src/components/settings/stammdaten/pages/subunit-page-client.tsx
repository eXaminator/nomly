"use client";

import * as React from "react";
import { Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import type { SubUnitManagedItem } from "@/lib/stammdaten/sub-unit/service";

import { DrawerShell } from "../drawer-shell";
import {
  SubUnitForm,
  type SubUnitFormPayload,
} from "../edit-forms/subunit-form";

export function SubUnitPageClient({
  initialItems,
}: {
  initialItems: SubUnitManagedItem[];
}) {
  const [items, setItems] = React.useState(initialItems);
  // Re-sync when the server sends fresh data (router.refresh after delete).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setItems(initialItems), [initialItems]);

  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<SubUnitManagedItem | null>(null);
  const [payload, setPayload] = React.useState<SubUnitFormPayload | null>(null);
  const [valid, setValid] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<SubUnitManagedItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const handlePayloadChange = React.useCallback(
    (p: SubUnitFormPayload, v: boolean) => {
      setPayload(p);
      setValid(v);
    },
    [],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.plural?.toLowerCase().includes(q) ?? false) ||
        i.ingredientName.toLowerCase().includes(q),
    );
  }, [items, query]);

  function openEdit(item: SubUnitManagedItem) {
    setEditing(item);
    setPayload(null);
    setValid(false);
    setError(null);
  }
  function closeDrawer() {
    setEditing(null);
    setPayload(null);
    setError(null);
  }

  async function save() {
    if (!editing || !payload) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/ingredients/sub-units/manage/${editing.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Speichern fehlgeschlagen (${res.status}).`);
      }
      const saved = (await res.json()) as SubUnitManagedItem;
      setItems((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      closeDrawer();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/v1/ingredients/sub-units/manage/${deleteTarget.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Löschen fehlgeschlagen (${res.status}).`);
      }
      setItems((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
      closeDrawer();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          Untereinheiten
          <span className="ml-2 text-base font-normal text-[var(--color-muted-fg)]">
            {filtered.length === items.length
              ? `(${items.length})`
              : `(${filtered.length} / ${items.length})`}
          </span>
        </h1>
      </div>

      <p className="text-sm text-[var(--color-muted-fg)]">
        Untereinheiten gehören jeweils zu einer Zutat. Neue legst du im
        Artikel-Formular an; hier kannst du alle vorhandenen finden und
        bearbeiten.
      </p>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-fg)]" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Suchen… (Zutat, Untereinheit, Plural)"
          className="pl-9 pr-10"
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Suche zurücksetzen"
            className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-fg)]">
          {query.trim().length > 0
            ? `Keine Treffer für „${query}".`
            : "Noch keine Untereinheiten angelegt."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-fg)]">
              <tr>
                <th className="px-3 py-2 font-medium">Zutat</th>
                <th className="px-3 py-2 font-medium">Untereinheit</th>
                <th className="px-3 py-2 font-medium">Plural</th>
                <th className="px-3 py-2 font-medium">pro Einkauf</th>
                <th className="px-3 py-2 font-medium">Verwendung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filtered.map((item) => (
                <tr
                  key={item.id}
                  className="cursor-pointer hover:bg-[var(--color-muted)]"
                  onClick={() => openEdit(item)}
                >
                  <td className="px-3 py-2 text-[var(--color-muted-fg)]">
                    {item.ingredientName}
                  </td>
                  <td className="px-3 py-2 font-medium">{item.name}</td>
                  <td className="px-3 py-2">
                    {item.plural ? (
                      item.plural
                    ) : (
                      <span className="text-[var(--color-muted-fg)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{item.perPurchase}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{item.usageCount} Rezepte</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DrawerShell
          open={true}
          onClose={closeDrawer}
          title={`${editing.ingredientName} · ${editing.name}`}
          mode="edit"
          onSave={save}
          saving={saving}
          saveDisabled={!valid}
          error={error}
          onDelete={() => setDeleteTarget(editing)}
        >
          <SubUnitForm item={editing} onPayloadChange={handlePayloadChange} />
        </DrawerShell>
      )}

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(v) => (!v ? setDeleteTarget(null) : undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Untereinheit löschen?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `„${deleteTarget.name}" von ${deleteTarget.ingredientName} wird gelöscht.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {deleteTarget && deleteTarget.usageCount > 0 ? (
              <p className="text-sm text-[var(--color-danger)]">
                Achtung: {deleteTarget.usageCount}{" "}
                {deleteTarget.usageCount === 1 ? "Rezeptzeile verwendet" : "Rezeptzeilen verwenden"}{" "}
                diese Untereinheit. Dort wird die Einheit anschließend entfernt.
              </p>
            ) : (
              <p className="text-sm text-[var(--color-muted-fg)]">
                Diese Untereinheit wird von keinem Rezept verwendet.
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Abbrechen
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Löscht…" : "Löschen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
