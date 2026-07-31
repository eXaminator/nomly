"use client";

import * as React from "react";
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
import type { DueSoonItem } from "@/lib/shopping/due-soon";
import {
  formatAverageInterval,
  formatLastPurchasedRelative,
} from "@/lib/ingredients/purchase-stats-format";
import { previewDueSoon, addDueSoonToList } from "./api";

type Props = {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
};

/** Human-readable "in X Tagen fällig" / "seit X Tagen überfällig". */
function formatDue(dueInDays: number): { text: string; overdue: boolean } {
  if (dueInDays < 0) {
    const d = Math.abs(dueInDays);
    return { text: `seit ${d} ${d === 1 ? "Tag" : "Tagen"} überfällig`, overdue: true };
  }
  if (dueInDays === 0) return { text: "heute fällig", overdue: true };
  return {
    text: `in ${dueInDays} ${dueInDays === 1 ? "Tag" : "Tagen"} fällig`,
    overdue: false,
  };
}

/**
 * "Fällige Zutaten hinzufügen": suggests articles whose recorded buying
 * cadence says they're due within the planner's day window, so they can be
 * put on the list in one go. Mirrors the add-staples dialog: preview →
 * select → commit. Overdue and not-yet-listed items start selected.
 */
export function AddDueSoonDialog({ open, onClose, onAdded }: Props) {
  const [items, setItems] = React.useState<DueSoonItem[] | null>(null);
  const [withinDays, setWithinDays] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    previewDueSoon()
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setWithinDays(data.withinDays);
        // Default selection: everything not already on the list (adding an
        // already-listed item is a no-op increment, so leave those opt-in).
        setSelected(
          new Set(
            data.items
              .filter((i) => !i.alreadyOnList)
              .map((i) => i.ingredientId),
          ),
        );
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Fehler beim Laden");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function toggle(ingredientId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ingredientId)) next.delete(ingredientId);
      else next.add(ingredientId);
      return next;
    });
  }

  function toggleAll(check: boolean) {
    if (!items) return;
    setSelected(check ? new Set(items.map((i) => i.ingredientId)) : new Set());
  }

  async function onSubmit() {
    if (selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await addDueSoonToList(Array.from(selected));
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  const isEmpty = items != null && items.length === 0;

  return (
    <Dialog open={open} onOpenChange={(v) => (!v && !submitting ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fällige Zutaten hinzufügen</DialogTitle>
          <DialogDescription>
            {withinDays != null
              ? `Zutaten, die laut ihrer Einkaufsstatistik in den nächsten ${withinDays} Tagen wieder fällig werden.`
              : "Zutaten, die laut ihrer Einkaufsstatistik demnächst wieder fällig werden."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleAll(true)}
              disabled={!items || items.length === 0}
            >
              Alle auswählen
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleAll(false)}
              disabled={!items || items.length === 0}
            >
              Keine auswählen
            </Button>
          </div>

          <div className="max-h-[50vh] overflow-y-auto rounded-[var(--radius)] border border-[var(--color-border)]">
            {loading ? (
              <div className="px-4 py-6 text-center text-sm text-[var(--color-muted-fg)]">
                Lädt…
              </div>
            ) : error ? (
              <div className="px-4 py-6 text-center text-sm text-[var(--color-danger)]">
                {error}
              </div>
            ) : isEmpty ? (
              <div className="px-4 py-6 text-center text-sm text-[var(--color-muted-fg)]">
                Zurzeit sind keine Zutaten fällig. Die Statistik braucht
                mindestens drei Einkäufe pro Zutat, um eine Vorhersage zu
                treffen.
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                {items?.map((it) => (
                  <DueRow
                    key={it.ingredientId}
                    item={it}
                    checked={selected.has(it.ingredientId)}
                    onToggle={() => toggle(it.ingredientId)}
                  />
                ))}
              </ul>
            )}
          </div>
        </DialogBody>
        <DialogFooter className="sm:items-center sm:justify-between">
          <span className="text-sm text-[var(--color-muted-fg)] sm:mr-auto">
            {selected.size} Artikel ausgewählt
          </span>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button onClick={onSubmit} disabled={submitting || selected.size === 0}>
            {submitting ? "Übernimmt…" : "Übernehmen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DueRow({
  item,
  checked,
  onToggle,
}: {
  item: DueSoonItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const due = formatDue(item.dueInDays);
  return (
    <li className="px-3 py-2">
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-1 size-4"
        />
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{item.ingredientName}</span>
            <span
              className={
                due.overdue
                  ? "rounded-full bg-[color-mix(in_srgb,var(--color-danger),transparent_85%)] px-2 py-0.5 text-xs text-[var(--color-danger)]"
                  : "rounded-full bg-[color-mix(in_srgb,var(--color-accent),transparent_85%)] px-2 py-0.5 text-xs text-[var(--color-accent)]"
              }
            >
              {due.text}
            </span>
            {item.alreadyOnList ? (
              <span className="rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-fg)]">
                Bereits auf der Liste
              </span>
            ) : null}
          </span>
          <span className="text-xs text-[var(--color-muted-fg)]">
            {formatLastPurchasedRelative(item.lastPurchasedAt)} gekauft ·{" "}
            {formatAverageInterval(item.averageIntervalDays)}
            {item.categoryName ? ` · ${item.categoryName}` : ""}
          </span>
        </span>
      </label>
    </li>
  );
}
