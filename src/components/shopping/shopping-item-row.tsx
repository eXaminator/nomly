"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ShoppingItemView } from "@/lib/shopping/items";
import { formatQty } from "@/lib/shopping/format";
import { cn } from "@/lib/cn";

type Props = {
  item: ShoppingItemView;
  onToggle: (item: ShoppingItemView) => void;
  onPatch: (
    id: number,
    patch: { quantity?: number | null; unitId?: number | null; note?: string | null },
  ) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
};

export function ShoppingItemRow({ item, onToggle, onPatch, onDelete }: Props) {
  const [editing, setEditing] = React.useState(false);
  const [qty, setQty] = React.useState(
    item.quantity != null ? String(item.quantity) : "",
  );
  const [unitText, setUnitText] = React.useState(item.unitName ?? "");
  const [note, setNote] = React.useState(item.note ?? "");
  const [saving, setSaving] = React.useState(false);

  // External (server-driven) item state changed — pull it back into the
  // edit form. The rule's "you might not need an effect" guidance is right
  // in general, but here the server's broadcast is the synchronisation
  // source, not a derived value.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQty(item.quantity != null ? String(item.quantity) : "");
    setUnitText(item.unitName ?? "");
    setNote(item.note ?? "");
  }, [item.id, item.quantity, item.unitName, item.note]);

  async function commit() {
    setSaving(true);
    try {
      const trimmed = qty.trim().replace(",", ".");
      const parsed = trimmed.length === 0 ? null : Number(trimmed);
      await onPatch(item.id, {
        quantity: parsed != null && Number.isFinite(parsed) ? parsed : null,
        note: note.trim().length > 0 ? note.trim() : null,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 sm:px-4",
        item.checked && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{item.name}</span>
              <span className="text-xs text-[var(--color-muted-fg)]">
                {item.refType === "product" ? "Produkt" : "Zutat"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="text"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="Menge"
                className="w-24"
              />
              <span className="text-sm text-[var(--color-muted-fg)]">
                {unitText || "—"}
              </span>
              <Input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Notiz"
                className="flex-1 min-w-[8rem]"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div
              className={cn(
                "flex flex-wrap items-baseline gap-2",
                item.checked && "line-through",
              )}
            >
              <span className="font-medium">{item.name}</span>
              {item.quantity != null || item.unitName ? (
                <span className="text-sm text-[var(--color-muted-fg)]">
                  {item.quantity != null ? formatQty(item.quantity) : ""}
                  {item.unitName ? ` ${item.unitName}` : ""}
                </span>
              ) : null}
              {item.note ? (
                <span className="text-xs text-[var(--color-muted-fg)]">
                  · {item.note}
                </span>
              ) : null}
            </div>
            {item.sources.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-muted-fg)]">
                <span>Für:</span>
                {item.sources.map((s, idx) => (
                  <React.Fragment key={`${s.mealPlanId}-${s.recipeId}`}>
                    {idx > 0 ? <span>·</span> : null}
                    <Link
                      href={`/plan?from=${s.mealDate}`}
                      className="rounded-full bg-[var(--color-muted)] px-2 py-0.5 hover:bg-[color-mix(in_srgb,var(--color-accent),transparent_90%)] hover:text-[var(--color-accent)]"
                    >
                      {s.recipeTitle} ({formatDate(s.mealDate)})
                    </Link>
                  </React.Fragment>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {editing ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Speichern"
              onClick={commit}
              disabled={saving}
            >
              <Check className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Abbrechen"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              <X className="size-4" />
            </Button>
          </>
        ) : (
          <>
            {item.checked ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Rückgängig"
                title="Rückgängig"
                onClick={() => onToggle(item)}
              >
                <RotateCcw className="size-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Abhaken"
                title="Abhaken"
                onClick={() => onToggle(item)}
              >
                <Check className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Bearbeiten"
              title="Bearbeiten"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Löschen"
              title="Löschen"
              className="text-[var(--color-danger)]"
              onClick={() => onDelete(item.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

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
