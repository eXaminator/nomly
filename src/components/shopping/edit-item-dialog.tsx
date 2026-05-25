"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ShoppingItemView } from "@/lib/shopping/items";

type Props = {
  /** When null the dialog is closed. */
  item: ShoppingItemView | null;
  onClose: () => void;
  onAddAmount: (
    id: number,
    amount: { quantity: number | null; unitId: number | null },
  ) => Promise<void>;
  onSetSourceQuantity: (
    id: number,
    sourceId: number,
    quantity: number | null,
  ) => Promise<void>;
  onSetManualAmountQuantity: (
    id: number,
    amountId: number,
    quantity: number | null,
  ) => Promise<void>;
  onDeleteSource: (id: number, sourceId: number) => Promise<void>;
  onDeleteManualAmount: (id: number, amountId: number) => Promise<void>;
  onPatchNote: (id: number, note: string | null) => Promise<void>;
};

function formatDate(iso: string): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  const weekday = dt.toLocaleDateString("de-DE", {
    weekday: "short",
    timeZone: "UTC",
  });
  const dm = dt.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
  return `${weekday}, ${dm}`;
}

function parseInput(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

async function searchUnits(query: string): Promise<ComboboxItem[]> {
  const res = await fetch(`/api/v1/units?q=${encodeURIComponent(query)}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    items: Array<{ id: number; name: string }>;
  };
  return data.items.map((u) => ({ id: u.id, name: u.name }));
}

export function EditItemDialog(props: Props) {
  return (
    <Dialog
      open={props.item != null}
      onOpenChange={(v) => (!v ? props.onClose() : undefined)}
    >
      <DialogContent className="sm:max-w-lg">
        {props.item != null ? (
          <EditItemDialogBody key={props.item.id} {...props} item={props.item} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type PendingNew = {
  tempId: number;
  quantity: string;
  unit: ComboboxItem | null;
};

function EditItemDialogBody({
  item,
  onClose,
  onAddAmount,
  onSetSourceQuantity,
  onSetManualAmountQuantity,
  onDeleteSource,
  onDeleteManualAmount,
  onPatchNote,
}: Props & { item: ShoppingItemView }) {
  const [sourceInputs, setSourceInputs] = React.useState<Record<number, string>>(
    () =>
      Object.fromEntries(
        item.sources.map((s) => [
          s.sourceId,
          s.contributedQuantity != null ? String(s.contributedQuantity) : "",
        ]),
      ),
  );
  const [manualInputs, setManualInputs] = React.useState<Record<number, string>>(
    () =>
      Object.fromEntries(
        item.manualAmounts.map((m) => [
          m.id,
          m.quantity != null ? String(m.quantity) : "",
        ]),
      ),
  );
  // Rows the user has flagged for deletion. The actual DELETE call happens
  // on Speichern.
  const [removedSources, setRemovedSources] = React.useState<Set<number>>(
    () => new Set(),
  );
  const [removedManuals, setRemovedManuals] = React.useState<Set<number>>(
    () => new Set(),
  );
  // Pending new manual rows — local-only until Speichern.
  const [pendingNew, setPendingNew] = React.useState<PendingNew[]>([]);
  const [note, setNote] = React.useState(item.note ?? "");
  const [saving, setSaving] = React.useState(false);

  // Default unit for a freshly-added row: pick the first unit that's
  // already present on this item (sources first, then manual amounts).
  // If nothing on the item has a unit, fall back to "Stück" via the lazy
  // lookup below. Cheap loop — the item never has many rows, so we just
  // recompute each render rather than fight the memoization lint rule.
  let itemDefaultUnit: ComboboxItem | null = null;
  for (const s of item.sources) {
    if (s.contributedUnitId != null && s.contributedUnit) {
      itemDefaultUnit = { id: s.contributedUnitId, name: s.contributedUnit };
      break;
    }
  }
  if (itemDefaultUnit == null) {
    for (const m of item.manualAmounts) {
      if (m.unitId != null && m.unitName) {
        itemDefaultUnit = { id: m.unitId, name: m.unitName };
        break;
      }
    }
  }

  const [stueckFallback, setStueckFallback] = React.useState<ComboboxItem | null>(
    null,
  );
  React.useEffect(() => {
    // Only fetch the fallback when the item itself has no usable unit AND
    // the user actually opens a new row.
    if (itemDefaultUnit != null) return;
    if (pendingNew.length === 0 || stueckFallback != null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/v1/units?q=${encodeURIComponent("Stück")}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          items: Array<{ id: number; name: string }>;
        };
        const hit = data.items.find((u) => u.name === "Stück") ?? data.items[0];
        if (!cancelled && hit) {
          const found = { id: hit.id, name: hit.name };
          setStueckFallback(found);
          setPendingNew((prev) =>
            prev.map((p) => (p.unit == null ? { ...p, unit: found } : p)),
          );
        }
      } catch {
        // Best-effort default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemDefaultUnit, pendingNew, stueckFallback]);

  const defaultUnit = itemDefaultUnit ?? stueckFallback;

  const nextTempIdRef = React.useRef(1);

  function addPending() {
    const tempId = nextTempIdRef.current++;
    setPendingNew((prev) => [
      ...prev,
      { tempId, quantity: "", unit: defaultUnit },
    ]);
  }

  function updatePending(tempId: number, patch: Partial<PendingNew>) {
    setPendingNew((prev) =>
      prev.map((p) => (p.tempId === tempId ? { ...p, ...patch } : p)),
    );
  }

  function removePending(tempId: number) {
    setPendingNew((prev) => prev.filter((p) => p.tempId !== tempId));
  }

  function toggleRemoveSource(sourceId: number) {
    setRemovedSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }

  function toggleRemoveManual(amountId: number) {
    setRemovedManuals((prev) => {
      const next = new Set(prev);
      if (next.has(amountId)) next.delete(amountId);
      else next.add(amountId);
      return next;
    });
  }

  async function commit() {
    setSaving(true);
    try {
      // Apply changes sequentially — each call bumps the item's version, so
      // parallel writes against the same row would race.
      for (const s of item.sources) {
        if (removedSources.has(s.sourceId)) {
          await onDeleteSource(item.id, s.sourceId);
          continue;
        }
        const next = parseInput(sourceInputs[s.sourceId]);
        if (next !== s.contributedQuantity) {
          await onSetSourceQuantity(item.id, s.sourceId, next);
        }
      }
      for (const m of item.manualAmounts) {
        if (removedManuals.has(m.id)) {
          await onDeleteManualAmount(item.id, m.id);
          continue;
        }
        const next = parseInput(manualInputs[m.id]);
        if (next !== m.quantity) {
          await onSetManualAmountQuantity(item.id, m.id, next);
        }
      }
      for (const p of pendingNew) {
        const n = parseInput(p.quantity);
        if (n == null || !p.unit) continue;
        await onAddAmount(item.id, { quantity: n, unitId: p.unit.id });
      }
      const trimmedNote = note.trim();
      const nextNote = trimmedNote.length > 0 ? trimmedNote : null;
      if (nextNote !== (item.note ?? null)) {
        await onPatchNote(item.id, nextNote);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-baseline gap-2">
          <DialogTitle>{item.name}</DialogTitle>
          <span className="text-xs uppercase tracking-wider text-[var(--color-muted-fg)]">
            Artikel
          </span>
        </div>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        {item.sources.length === 0 &&
        item.manualAmounts.length === 0 &&
        pendingNew.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">
            Keine Mengen erfasst.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {item.sources.map((s) => {
              const removed = removedSources.has(s.sourceId);
              return (
                <li
                  key={`src-${s.sourceId}`}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span
                    className={`min-w-0 flex-1 text-sm ${
                      removed ? "line-through opacity-50" : ""
                    }`}
                  >
                    <span className="font-medium">{s.recipeTitle}</span>
                    <span className="ml-1 text-xs text-[var(--color-muted-fg)]">
                      ({formatDate(s.mealDate)})
                    </span>
                  </span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={sourceInputs[s.sourceId] ?? ""}
                    onChange={(e) =>
                      setSourceInputs((prev) => ({
                        ...prev,
                        [s.sourceId]: e.target.value,
                      }))
                    }
                    placeholder="Menge"
                    disabled={removed}
                    className="w-24"
                  />
                  <span className="w-10 text-xs text-[var(--color-muted-fg)]">
                    {s.contributedUnit ?? ""}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={removed ? "Entfernen rückgängig" : "Entfernen"}
                    title={removed ? "Entfernen rückgängig" : "Entfernen"}
                    onClick={() => toggleRemoveSource(s.sourceId)}
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              );
            })}
            {item.manualAmounts.map((m) => {
              const removed = removedManuals.has(m.id);
              return (
                <li
                  key={`man-${m.id}`}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span
                    className={`min-w-0 flex-1 text-sm ${
                      removed ? "line-through opacity-50" : ""
                    }`}
                  >
                    <span className="font-medium">Manuell</span>
                  </span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={manualInputs[m.id] ?? ""}
                    onChange={(e) =>
                      setManualInputs((prev) => ({
                        ...prev,
                        [m.id]: e.target.value,
                      }))
                    }
                    placeholder="Menge"
                    disabled={removed}
                    className="w-24"
                  />
                  <span className="w-10 text-xs text-[var(--color-muted-fg)]">
                    {m.unitName ?? ""}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={removed ? "Entfernen rückgängig" : "Entfernen"}
                    title={removed ? "Entfernen rückgängig" : "Entfernen"}
                    onClick={() => toggleRemoveManual(m.id)}
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              );
            })}
            {pendingNew.map((p) => (
              <li
                key={`new-${p.tempId}`}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">Manuell</span>
                  <span className="ml-1 text-xs text-[var(--color-muted-fg)]">
                    (neu)
                  </span>
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={p.quantity}
                  onChange={(e) =>
                    updatePending(p.tempId, { quantity: e.target.value })
                  }
                  placeholder="Menge"
                  className="w-24"
                />
                <Combobox
                  value={p.unit}
                  onChange={(u) => updatePending(p.tempId, { unit: u })}
                  search={searchUnits}
                  placeholder="Einheit"
                  className="w-24"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Entfernen"
                  title="Entfernen"
                  onClick={() => removePending(p.tempId)}
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={addPending}
          className="self-start"
        >
          <Plus className="size-4" />
          Weitere Menge
        </Button>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`edit-note-${item.id}`}>Notiz</Label>
          <Input
            id={`edit-note-${item.id}`}
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Abbrechen
        </Button>
        <Button onClick={commit} disabled={saving}>
          {saving ? "Speichert…" : "Speichern"}
        </Button>
      </DialogFooter>
    </>
  );
}
