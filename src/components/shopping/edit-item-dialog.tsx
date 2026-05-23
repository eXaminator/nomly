"use client";

import * as React from "react";
import { Check, Plus, X } from "lucide-react";
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
  /** When null the dialog is closed. Open/close is controlled by the parent
   *  swapping this between an item and null. */
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
  // Mount the body keyed by item.id so opening a different row resets the
  // local form state — the outer Dialog stays mounted so its close
  // animation can play out when the parent flips item back to null.
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

function EditItemDialogBody({
  item,
  onClose,
  onAddAmount,
  onSetSourceQuantity,
  onSetManualAmountQuantity,
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
  const [note, setNote] = React.useState(item.note ?? "");
  const [saving, setSaving] = React.useState(false);
  const [addingNew, setAddingNew] = React.useState(false);
  const [newAmountQty, setNewAmountQty] = React.useState("");
  const [newAmountUnit, setNewAmountUnit] = React.useState<ComboboxItem | null>(
    null,
  );

  // Default the new-amount unit to "Stück" the first time the inline
  // "Weitere Menge" form opens — by a wide margin the most common ad-hoc
  // unit. Lazy so the lookup only fires when the user actually opens it.
  React.useEffect(() => {
    if (!addingNew || newAmountUnit != null) return;
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
          setNewAmountUnit({ id: hit.id, name: hit.name });
        }
      } catch {
        // Best-effort default; leave the picker empty if the lookup fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addingNew, newAmountUnit]);

  async function addNewAmount() {
    const n = parseInput(newAmountQty);
    if (n == null || !newAmountUnit) return;
    setSaving(true);
    try {
      await onAddAmount(item.id, { quantity: n, unitId: newAmountUnit.id });
      setNewAmountQty("");
      setNewAmountUnit(null);
      setAddingNew(false);
    } finally {
      setSaving(false);
    }
  }

  async function commit() {
    setSaving(true);
    try {
      // Sequential — each PATCH bumps the item's version, so parallel calls
      // would race over the same row.
      for (const s of item.sources) {
        const next = parseInput(sourceInputs[s.sourceId]);
        if (next === s.contributedQuantity) continue;
        await onSetSourceQuantity(item.id, s.sourceId, next);
      }
      for (const m of item.manualAmounts) {
        const next = parseInput(manualInputs[m.id]);
        if (next === m.quantity) continue;
        await onSetManualAmountQuantity(item.id, m.id, next);
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
            {item.refType === "product" ? "Produkt" : "Zutat"}
          </span>
        </div>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        {item.sources.length === 0 && item.manualAmounts.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">
            Keine Mengen erfasst.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {item.sources.map((s) => (
              <li
                key={`src-${s.sourceId}`}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="min-w-0 flex-1 text-sm">
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
                  className="w-24"
                />
                <span className="w-10 text-xs text-[var(--color-muted-fg)]">
                  {s.contributedUnit ?? ""}
                </span>
              </li>
            ))}
            {item.manualAmounts.map((m) => (
              <li
                key={`man-${m.id}`}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="min-w-0 flex-1 text-sm italic text-[var(--color-muted-fg)]">
                  Manuell
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
                  className="w-24"
                />
                <span className="w-10 text-xs text-[var(--color-muted-fg)]">
                  {m.unitName ?? ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {addingNew ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="text"
              inputMode="decimal"
              value={newAmountQty}
              onChange={(e) => setNewAmountQty(e.target.value)}
              placeholder="Menge"
              className="w-24"
              autoFocus
            />
            <Combobox
              value={newAmountUnit}
              onChange={setNewAmountUnit}
              search={searchUnits}
              placeholder="Einheit"
              className="min-w-[8rem] flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Hinzufügen"
              onClick={addNewAmount}
              disabled={
                saving || newAmountQty.trim().length === 0 || newAmountUnit == null
              }
            >
              <Check className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Abbrechen"
              onClick={() => {
                setAddingNew(false);
                setNewAmountQty("");
                setNewAmountUnit(null);
              }}
              disabled={saving}
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddingNew(true)}
            className="self-start"
          >
            <Plus className="size-4" />
            Weitere Menge
          </Button>
        )}
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
