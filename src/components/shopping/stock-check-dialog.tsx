"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
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
import type { ShoppingItemView } from "@/lib/shopping/items";
import { setStockBatch } from "./api";

type Props = {
  open: boolean;
  items: ShoppingItemView[];
  onClose: () => void;
  onSaved: (items: ShoppingItemView[]) => void;
};

async function searchUnits(query: string): Promise<ComboboxItem[]> {
  const res = await fetch(`/api/v1/units?q=${encodeURIComponent(query)}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { items: Array<{ id: number; name: string }> };
  return data.items.map((u) => ({ id: u.id, name: u.name }));
}

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
  const [saving, setSaving] = React.useState(false);

  async function commit() {
    setSaving(true);
    try {
      const entries = rows
        .map((i) => {
          const next = parseInput(qty[i.id] ?? "");
          const prev = i.stock?.quantity ?? null;
          const nextUnit = units[i.id]?.id ?? null;
          const prevUnit = i.stock?.unitId ?? null;
          const changed = next !== prev || (next != null && nextUnit !== prevUnit);
          if (!changed) return null;
          return { itemId: i.id, quantity: next, unitId: next == null ? null : nextUnit };
        })
        .filter((e): e is { itemId: number; quantity: number | null; unitId: number | null } => e != null);
      if (entries.length === 0) {
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
            {rows.map((i) => (
              <li key={i.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{i.name}</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={qty[i.id] ?? ""}
                  onChange={(e) =>
                    setQty((prev) => ({ ...prev, [i.id]: e.target.value }))
                  }
                  placeholder="Menge"
                  className="w-20"
                  aria-label={`Auf Lager: ${i.name}`}
                />
                <Combobox
                  value={units[i.id] ?? null}
                  onChange={(u) => setUnits((prev) => ({ ...prev, [i.id]: u }))}
                  search={searchUnits}
                  placeholder="Einheit"
                  className="w-28"
                />
              </li>
            ))}
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
