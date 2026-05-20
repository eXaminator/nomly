"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectSearch } from "@/components/ui/select-search";

import { ImpactSection } from "../impact-section";
import type { EditFormProps } from "../list-shell";

export type SupermarketItem = {
  id: number;
  name: string;
  orderedCategoryCount: number;
};

type OrderedCategory = {
  categoryId: number;
  categoryName: string;
};

export function SupermarketForm({
  item,
  onPayloadChange,
}: EditFormProps<SupermarketItem>) {
  const [name, setName] = React.useState(item?.name ?? "");
  const [orderedCategories, setOrderedCategories] = React.useState<
    OrderedCategory[]
  >([]);
  const [loadingDetail, setLoadingDetail] = React.useState(item != null);
  const [detailError, setDetailError] = React.useState<string | null>(null);

  // In edit mode we only get the list-row shape (no orderedCategories) — fetch
  // the detail once on mount to hydrate the form.
  React.useEffect(() => {
    if (!item) return;
    let cancelled = false;
    // setState-in-effect: synchronizes external (server-fetched) supermarket
    // detail into local state on mount in edit mode.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingDetail(true);
     
    setDetailError(null);
    fetch(`/api/v1/supermarkets/manage/${item.id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as {
          orderedCategories: Array<{
            categoryId: number;
            categoryName: string;
          }>;
        };
      })
      .then((detail) => {
        if (cancelled) return;
        setOrderedCategories(
          detail.orderedCategories.map((c) => ({
            categoryId: c.categoryId,
            categoryName: c.categoryName,
          })),
        );
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setDetailError(
          e instanceof Error ? e.message : "Konnte Details nicht laden.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item]);

  React.useEffect(() => {
    const trimmed = name.trim();
    onPayloadChange(
      {
        name: trimmed,
        orderedCategoryIds: orderedCategories.map((c) => c.categoryId),
      },
      trimmed.length > 0,
    );
  }, [name, orderedCategories, onPayloadChange]);

  function moveUp(index: number) {
    if (index <= 0) return;
    setOrderedCategories((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveDown(index: number) {
    setOrderedCategories((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  function removeAt(index: number) {
    setOrderedCategories((prev) => prev.filter((_, i) => i !== index));
  }

  const searchCategories = React.useCallback(
    async (q: string) => {
      const res = await fetch(`/api/v1/categories?q=${encodeURIComponent(q)}`);
      if (!res.ok) return [];
      const body = (await res.json()) as {
        items: Array<{ id: number; name: string }>;
      };
      const taken = new Set(orderedCategories.map((c) => c.categoryId));
      return body.items.filter((i) => !taken.has(i.id));
    },
    [orderedCategories],
  );

  // SelectSearch holds a "selected value" but for our picker we want it to act
  // like a one-shot add — keep value=null and append on change.
  function handlePickCategory(
    picked: { id: number; name: string } | null,
  ): void {
    if (!picked) return;
    setOrderedCategories((prev) => {
      if (prev.some((c) => c.categoryId === picked.id)) return prev;
      return [...prev, { categoryId: picked.id, categoryName: picked.name }];
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="supermarket-name">Name</Label>
        <Input
          id="supermarket-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Kategorien-Reihenfolge</Label>
        {loadingDetail ? (
          <div className="flex items-center gap-2 rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-3 py-4 text-sm text-[var(--color-muted-fg)]">
            <Loader2 className="size-4 animate-spin" /> Lädt Kategorien…
          </div>
        ) : detailError ? (
          <p className="text-sm text-[var(--color-danger)]">{detailError}</p>
        ) : orderedCategories.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-3 py-4 text-sm text-[var(--color-muted-fg)]">
            Noch keine Kategorien geordnet. Wähle unten eine aus, um sie ans
            Ende zu hängen.
          </div>
        ) : (
          <ol className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
            {orderedCategories.map((c, idx) => (
              <li
                key={c.categoryId}
                className="flex items-center gap-2 px-3 py-2"
              >
                <span className="w-6 text-xs tabular-nums text-[var(--color-muted-fg)]">
                  {idx + 1}.
                </span>
                <span className="flex-1 truncate text-sm">{c.categoryName}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => moveUp(idx)}
                  disabled={idx === 0}
                  aria-label={`${c.categoryName} nach oben verschieben`}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => moveDown(idx)}
                  disabled={idx === orderedCategories.length - 1}
                  aria-label={`${c.categoryName} nach unten verschieben`}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeAt(idx)}
                  aria-label={`${c.categoryName} entfernen`}
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ol>
        )}
        {!loadingDetail && (
          <SelectSearch
            value={null}
            onChange={handlePickCategory}
            search={searchCategories}
            placeholder="Kategorie hinzufügen…"
          />
        )}
      </div>

      {item && <ImpactSection entityKind="supermarket" id={item.id} />}
    </div>
  );
}
