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
import type { StaplePreviewGroup, StaplePreviewItem } from "@/lib/staples/preview";
import { previewStaples as apiPreview, addStaplesToList } from "./api";

type Props = {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
};

/** groupId → set of selected stapleGroupItemIds. */
type SelectionState = Map<number, Set<number>>;
/** "${groupId}:${itemId}" → raw quantity string. */
type QuantityState = Map<string, string>;

const qtyKey = (groupId: number, itemId: number) => `${groupId}:${itemId}`;

function formatQty(n: number | null): string {
  return n == null ? "" : String(n).replace(".", ",");
}

function parseQty(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Tri-state for a group's select-all checkbox. Every item is selectable
 *  (staples have no "optional" concept). */
function groupState(
  items: StaplePreviewItem[],
  selected: Set<number>,
): "none" | "some" | "all" {
  if (items.length === 0) return "none";
  const n = items.filter((i) => selected.has(i.stapleGroupItemId)).length;
  if (n === 0) return "none";
  return n === items.length ? "all" : "some";
}

/**
 * Add items from the standard lists ("Standardlisten") to the shopping list.
 * Mirrors the add-meals dialog: every list is shown with its items, the user
 * checks/unchecks individual items or whole lists and may tweak quantities.
 */
export function AddStaplesDialog({ open, onClose, onAdded }: Props) {
  const [groups, setGroups] = React.useState<StaplePreviewGroup[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [selection, setSelection] = React.useState<SelectionState>(new Map());
  const [quantities, setQuantities] = React.useState<QuantityState>(new Map());

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    apiPreview()
      .then((rows) => {
        if (cancelled) return;
        setGroups(rows);
        // Start fully unchecked — the user opts in to whatever they want.
        const sel = new Map<number, Set<number>>();
        const qs = new Map<string, string>();
        for (const g of rows) {
          sel.set(g.stapleGroupId, new Set());
          for (const it of g.items) {
            qs.set(qtyKey(g.stapleGroupId, it.stapleGroupItemId), formatQty(it.quantity));
          }
        }
        setSelection(sel);
        setQuantities(qs);
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

  function toggleItem(groupId: number, itemId: number) {
    setSelection((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(groupId) ?? []);
      if (set.has(itemId)) set.delete(itemId);
      else set.add(itemId);
      next.set(groupId, set);
      return next;
    });
  }

  function toggleGroup(group: StaplePreviewGroup) {
    setSelection((prev) => {
      const next = new Map(prev);
      const ids = group.items.map((i) => i.stapleGroupItemId);
      const existing = next.get(group.stapleGroupId) ?? new Set();
      const allChecked = ids.length > 0 && ids.every((id) => existing.has(id));
      next.set(group.stapleGroupId, allChecked ? new Set() : new Set(ids));
      return next;
    });
  }

  function toggleAll(check: boolean) {
    if (!groups) return;
    const next = new Map<number, Set<number>>();
    for (const g of groups) {
      next.set(
        g.stapleGroupId,
        check ? new Set(g.items.map((i) => i.stapleGroupItemId)) : new Set(),
      );
    }
    setSelection(next);
  }

  function setQty(groupId: number, itemId: number, value: string) {
    setQuantities((prev) => {
      const next = new Map(prev);
      next.set(qtyKey(groupId, itemId), value);
      return next;
    });
  }

  const totalSelected = React.useMemo(() => {
    let n = 0;
    for (const set of selection.values()) n += set.size;
    return n;
  }, [selection]);

  async function onSubmit() {
    if (!groups || totalSelected === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const sel = Array.from(selection.entries())
        .filter(([, set]) => set.size > 0)
        .map(([stapleGroupId, set]) => ({
          stapleGroupId,
          items: Array.from(set).map((stapleGroupItemId) => ({
            stapleGroupItemId,
            quantity: parseQty(quantities.get(qtyKey(stapleGroupId, stapleGroupItemId))),
          })),
        }));
      await addStaplesToList(sel);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v && !submitting ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Standards hinzufügen</DialogTitle>
          <DialogDescription>
            Wähle aus, welche Artikel aus deinen Standardlisten in die
            Einkaufsliste übernommen werden.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleAll(true)}
              disabled={!groups || groups.length === 0}
            >
              Alle auswählen
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleAll(false)}
              disabled={!groups || groups.length === 0}
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
            ) : groups && groups.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-[var(--color-muted-fg)]">
                Noch keine Standardlisten angelegt.
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                {groups?.map((g) => (
                  <GroupRow
                    key={g.stapleGroupId}
                    group={g}
                    selected={selection.get(g.stapleGroupId) ?? new Set()}
                    quantities={quantities}
                    onToggleGroup={() => toggleGroup(g)}
                    onToggleItem={(itemId) => toggleItem(g.stapleGroupId, itemId)}
                    onChangeQuantity={(itemId, value) =>
                      setQty(g.stapleGroupId, itemId, value)
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </DialogBody>
        <DialogFooter className="sm:items-center sm:justify-between">
          <span className="text-sm text-[var(--color-muted-fg)] sm:mr-auto">
            {totalSelected} Artikel ausgewählt
          </span>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button onClick={onSubmit} disabled={submitting || totalSelected === 0}>
            {submitting ? "Übernimmt…" : "Übernehmen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GroupRow({
  group,
  selected,
  quantities,
  onToggleGroup,
  onToggleItem,
  onChangeQuantity,
}: {
  group: StaplePreviewGroup;
  selected: Set<number>;
  quantities: QuantityState;
  onToggleGroup: () => void;
  onToggleItem: (itemId: number) => void;
  onChangeQuantity: (itemId: number, value: string) => void;
}) {
  const state = groupState(group.items, selected);
  const hasItems = group.items.length > 0;
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2">
      <label
        className={`flex items-center gap-2 ${hasItems ? "cursor-pointer" : ""}`}
      >
        <input
          type="checkbox"
          checked={state === "all"}
          ref={(el) => {
            if (el) el.indeterminate = state === "some";
          }}
          onChange={onToggleGroup}
          disabled={!hasItems}
          className="size-4"
        />
        <span className="flex flex-1 flex-wrap items-baseline gap-2">
          <span className="font-medium">{group.name}</span>
          {group.alreadyOnList ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--color-accent),transparent_85%)] px-2 py-0.5 text-xs text-[var(--color-accent)]">
              Bereits auf der Liste
            </span>
          ) : null}
        </span>
      </label>
      <ul className="ml-6 flex flex-col gap-1">
        {group.items.map((it) => (
          <li key={it.stapleGroupItemId}>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(it.stapleGroupItemId)}
                onChange={() => onToggleItem(it.stapleGroupItemId)}
                className="mt-1 size-3.5"
              />
              <span className="flex flex-1 flex-wrap items-center gap-2">
                <span>{it.ingredientName}</span>
                {it.note ? (
                  <span className="text-xs text-[var(--color-muted-fg)]">
                    · {it.note}
                  </span>
                ) : null}
              </span>
              <span
                className="flex shrink-0 items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={quantities.get(qtyKey(group.stapleGroupId, it.stapleGroupItemId)) ?? ""}
                  onChange={(e) => onChangeQuantity(it.stapleGroupItemId, e.target.value)}
                  className="h-7 w-16 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-right text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                />
                <span className="w-10 text-xs text-[var(--color-muted-fg)]">
                  {it.unitName ?? ""}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </li>
  );
}
