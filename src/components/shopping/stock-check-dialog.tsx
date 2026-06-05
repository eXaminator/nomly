"use client";

import * as React from "react";
import { Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ComboboxItem } from "@/components/ui/combobox";
import { AmountList } from "./amount-list";
import { UnitSelect } from "./unit-select";
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
import { cn } from "@/lib/cn";
import type { ShoppingItemView } from "@/lib/shopping/items";
import { previewStockCoverage, setStockBatch } from "./api";

type Props = {
  open: boolean;
  items: ShoppingItemView[];
  onClose: () => void;
  onSaved: (items: ShoppingItemView[]) => void;
};

function parseInput(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function initialUnit(item: ShoppingItemView): ComboboxItem | null {
  if (item.stock?.unitId != null && item.stock.unitName) {
    return { id: item.stock.unitId, name: item.stock.unitName };
  }
  if (item.defaultUnitId != null && item.defaultUnitName) {
    return { id: item.defaultUnitId, name: item.defaultUnitName };
  }
  return null;
}

export function StockCheckDialog({ open, items, onClose, onSaved }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        {open ? (
          <StockCheckBody items={items} onClose={onClose} onSaved={onSaved} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StockCheckBody({
  items,
  onClose,
  onSaved,
}: Omit<Props, "open">) {
  // Stable snapshot for the lifetime of the dialog so inputs don't reshuffle
  // when a background realtime update arrives.
  const rows = React.useMemo(() => items, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [qty, setQty] = React.useState<Record<number, string>>(() =>
    Object.fromEntries(
      rows.map((i) => [i.id, i.stock?.quantity != null ? String(i.stock.quantity) : ""]),
    ),
  );
  const [units, setUnits] = React.useState<Record<number, ComboboxItem | null>>(() =>
    Object.fromEntries(rows.map((i) => [i.id, initialUnit(i)])),
  );
  const [removed, setRemoved] = React.useState<Record<number, boolean>>({});
  // Items whose demand the current inputs would fully cover — the server
  // removes those on save, so the row shows it up front (debounced dry-run).
  const [covered, setCovered] = React.useState<Set<number>>(new Set());
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (rows.length === 0) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const entries = rows
        .filter((i) => !removed[i.id])
        .map((i) => ({
          itemId: i.id,
          quantity: parseInput(qty[i.id] ?? ""),
          unitId: units[i.id]?.id ?? null,
        }));
      try {
        const ids = await previewStockCoverage(entries);
        if (!cancelled) setCovered(new Set(ids));
      } catch {
        // Best-effort hint only — save still applies the removal server-side.
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [rows, qty, units, removed]);

  async function commit() {
    setSaving(true);
    try {
      const entries: Array<{
        itemId: number;
        quantity: number | null;
        unitId: number | null;
        remove?: boolean;
      }> = [];
      for (const i of rows) {
        if (removed[i.id]) {
          entries.push({ itemId: i.id, quantity: null, unitId: null, remove: true });
          continue;
        }
        const next = parseInput(qty[i.id] ?? "");
        const prev = i.stock?.quantity ?? null;
        const nextUnit = units[i.id]?.id ?? null;
        const prevUnit = i.stock?.unitId ?? null;
        const changed = next !== prev || (next != null && nextUnit !== prevUnit);
        if (!changed) continue;
        entries.push({ itemId: i.id, quantity: next, unitId: next == null ? null : nextUnit });
      }
      // An empty batch still runs the server-side coverage sweep, so don't
      // skip the call while covered rows are showing a removal hint.
      if (entries.length === 0 && covered.size === 0) {
        onClose();
        return;
      }
      const updated = await setStockBatch(entries);
      onSaved(updated);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Auf Lager prüfen</DialogTitle>
        <DialogDescription>
          Trag ein, was du schon zu Hause hast — es wird vom Gesamtbedarf
          derselben Einheit abgezogen.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">
            Keine Artikel auf der Liste.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((i) => {
              const isRemoved = !!removed[i.id];
              const isCovered = !isRemoved && covered.has(i.id);
              return (
                <li key={i.id} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-sm",
                          isRemoved && "text-[var(--color-muted-fg)] line-through",
                        )}
                      >
                        {i.name}
                      </p>
                      {i.requiredAmounts.some(
                        (a) => a.quantity != null || a.unitName != null,
                      ) ? (
                        <p className="truncate text-xs text-[var(--color-muted-fg)]">
                          Benötigt:{" "}
                          <AmountList amounts={i.requiredAmounts} className="text-xs" />
                        </p>
                      ) : null}
                    </div>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={qty[i.id] ?? ""}
                      onChange={(e) =>
                        setQty((prev) => ({ ...prev, [i.id]: e.target.value }))
                      }
                      placeholder="Menge"
                      className="w-20"
                      disabled={isRemoved}
                      aria-label={`Auf Lager: ${i.name}`}
                    />
                    <UnitSelect
                      value={units[i.id] ?? null}
                      onChange={(u) => setUnits((prev) => ({ ...prev, [i.id]: u }))}
                      className="w-28"
                      disabled={isRemoved}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setRemoved((prev) => ({ ...prev, [i.id]: !prev[i.id] }))
                      }
                      aria-label={
                        isRemoved
                          ? `Entfernen rückgängig: ${i.name}`
                          : `Von der Liste entfernen: ${i.name}`
                      }
                      title={isRemoved ? "Entfernen rückgängig" : "Von der Liste entfernen"}
                    >
                      {isRemoved ? (
                        <Undo2 className="size-4" />
                      ) : (
                        <Trash2 className="size-4 text-[var(--color-danger)]" />
                      )}
                    </Button>
                  </div>
                  {isRemoved || isCovered ? (
                    <p className="text-xs text-[var(--color-danger)]">
                      {isRemoved
                        ? "Wird beim Speichern von der Liste entfernt."
                        : "Bedarf gedeckt — wird beim Speichern von der Liste entfernt."}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
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
