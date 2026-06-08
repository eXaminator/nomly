"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ComboboxItem } from "@/components/ui/combobox";
import { UnitSelect } from "./unit-select";
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
  onDeleteStapleSource: (id: number, sourceId: number) => Promise<void>;
  onDeleteManualAmount: (id: number, amountId: number) => Promise<void>;
  onPatchNote: (id: number, note: string | null) => Promise<void>;
  onSetStock: (
    id: number,
    stock: { quantity: number | null; unitId: number | null },
  ) => Promise<void>;
  onClearStock: (id: number) => Promise<void>;
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

function formatQuantity(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, "");
}

function parseInput(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
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
  onDeleteStapleSource,
  onDeleteManualAmount,
  onPatchNote,
  onSetStock,
  onClearStock,
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
  const [removedStapleSources, setRemovedStapleSources] = React.useState<
    Set<number>
  >(() => new Set());
  // Pending new manual rows — local-only until Speichern.
  const [pendingNew, setPendingNew] = React.useState<PendingNew[]>([]);
  const [note, setNote] = React.useState(item.note ?? "");
  const [stockQty, setStockQty] = React.useState(
    item.stock?.quantity != null ? String(item.stock.quantity) : "",
  );
  const [stockUnit, setStockUnit] = React.useState<ComboboxItem | null>(() =>
    item.stock?.unitId != null && item.stock.unitName
      ? { id: item.stock.unitId, name: item.stock.unitName }
      : item.defaultUnitId != null && item.defaultUnitName
        ? { id: item.defaultUnitId, name: item.defaultUnitName }
        : null,
  );
  const [saving, setSaving] = React.useState(false);

  // Default unit for a freshly-added row: pick the first unit already present
  // on this item (sources first, then manual amounts) so a new amount stays in
  // the same dimension. When the item carries no unit yet, fall back to the
  // article's own default unit (which itself resolves to "Stück" when the
  // article has none). Cheap loop — the item never has many rows.
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

  const articleDefaultUnit: ComboboxItem | null =
    item.defaultUnitId != null && item.defaultUnitName
      ? { id: item.defaultUnitId, name: item.defaultUnitName }
      : null;

  const defaultUnit = itemDefaultUnit ?? articleDefaultUnit;

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

  function toggleRemoveStapleSource(sourceId: number) {
    setRemovedStapleSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
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
      for (const s of item.stapleSources) {
        if (removedStapleSources.has(s.sourceId)) {
          await onDeleteStapleSource(item.id, s.sourceId);
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
      // "Auf Lager": empty clears the row; a value upserts it.
      const nextStockQty = parseInput(stockQty);
      const prevStockQty = item.stock?.quantity ?? null;
      const prevStockUnit = item.stock?.unitId ?? null;
      const nextStockUnit = stockUnit?.id ?? null;
      if (nextStockQty == null) {
        if (prevStockQty != null) await onClearStock(item.id);
      } else if (nextStockQty !== prevStockQty || nextStockUnit !== prevStockUnit) {
        await onSetStock(item.id, { quantity: nextStockQty, unitId: nextStockUnit });
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
        item.stapleSources.length === 0 &&
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
                    {s.mealDate ? (
                      <span className="ml-1 text-xs text-[var(--color-muted-fg)]">
                        ({formatDate(s.mealDate)})
                      </span>
                    ) : null}
                    {s.mealNote ? (
                      <span className="ml-1 text-xs italic text-[var(--color-muted-fg)]">
                        · {s.mealNote}
                      </span>
                    ) : null}
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
            {item.stapleSources.map((s) => {
              const removed = removedStapleSources.has(s.sourceId);
              return (
                <li
                  key={`stp-${s.sourceId}`}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span
                    className={`min-w-0 flex-1 text-sm ${
                      removed ? "line-through opacity-50" : ""
                    }`}
                  >
                    <span className="font-medium">{s.stapleGroupName}</span>
                  </span>
                  <span className="w-24 text-right text-sm text-[var(--color-muted-fg)]">
                    {s.contributedQuantity != null
                      ? formatQuantity(s.contributedQuantity)
                      : "—"}
                  </span>
                  <span className="w-10 text-xs text-[var(--color-muted-fg)]">
                    {s.contributedUnit ?? ""}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={removed ? "Entfernen rückgängig" : "Entfernen"}
                    title={removed ? "Entfernen rückgängig" : "Entfernen"}
                    onClick={() => toggleRemoveStapleSource(s.sourceId)}
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
                <UnitSelect
                  value={p.unit}
                  onChange={(u) => updatePending(p.tempId, { unit: u })}
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
        <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3">
          <Label>Auf Lager</Label>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              inputMode="decimal"
              value={stockQty}
              onChange={(e) => setStockQty(e.target.value)}
              placeholder="Menge"
              className="w-24"
              aria-label="Auf Lager Menge"
            />
            <UnitSelect
              value={stockUnit}
              onChange={setStockUnit}
              className="w-28"
            />
          </div>
          <p className="text-xs text-[var(--color-muted-fg)]">
            Wird vom Gesamtbedarf derselben Einheit abgezogen. Leer lassen, um
            nichts abzuziehen.
          </p>
        </div>
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
