"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ShoppingItemView } from "@/lib/shopping/items";
import { ShoppingItemRow } from "./shopping-item-row";
import { AddItemDialog } from "./add-item-dialog";
import { AddMealsDialog } from "./add-meals-dialog";
import { SupermarketFilter } from "./supermarket-filter";
import {
  deleteItem as apiDelete,
  patchItem as apiPatch,
} from "./api";

const STORAGE_KEY = "nomly.shopping.supermarketId";

export type SupermarketSummary = {
  id: number;
  name: string;
  categories: Array<{ categoryId: number; sortOrder: number }>;
};

type Props = {
  initialItems: ShoppingItemView[];
  supermarkets: SupermarketSummary[];
  defaultLengthDays: number;
  today: string;
};

export function ShoppingListView({
  initialItems,
  supermarkets,
  defaultLengthDays,
  today,
}: Props) {
  const router = useRouter();
  const [items, setItems] = React.useState(initialItems);
  React.useEffect(() => setItems(initialItems), [initialItems]); // eslint-disable-line react-hooks/set-state-in-effect
  const [supermarketId, setSupermarketId] = React.useState<number | null>(null);
  const [addItemOpen, setAddItemOpen] = React.useState(false);
  const [addMealsOpen, setAddMealsOpen] = React.useState(false);

  // Hydrate supermarket filter from localStorage. Done in an effect so SSR/CSR
  // markup matches (localStorage isn't available on the server).
  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored == null) return;
    const n = Number.parseInt(stored, 10);
    if (Number.isFinite(n) && supermarkets.some((s) => s.id === n)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupermarketId(n);
    }
  }, [supermarkets]);

  function persistSupermarket(id: number | null) {
    setSupermarketId(id);
    if (id == null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, String(id));
    }
  }

  async function onToggleCheck(item: ShoppingItemView) {
    const nextChecked = !item.checked;
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? {
              ...i,
              checked: nextChecked,
              checkedAt: nextChecked ? Math.floor(Date.now() / 1000) : null,
            }
          : i,
      ),
    );
    try {
      const updated = await apiPatch(item.id, { checked: nextChecked });
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch {
      router.refresh();
    }
  }

  async function onPatch(
    id: number,
    patch: { quantity?: number | null; unitId?: number | null; note?: string | null },
  ) {
    try {
      const updated = await apiPatch(id, patch);
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch {
      router.refresh();
    }
  }

  async function onDelete(id: number) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await apiDelete(id);
    } catch {
      router.refresh();
    }
  }

  const grouped = React.useMemo(
    () => groupItems(items, supermarketId, supermarkets),
    [items, supermarketId, supermarkets],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Einkaufsliste
          </h1>
          <span className="text-sm text-[var(--color-muted-fg)]">
            {items.length} Einträge ·{" "}
            {items.filter((i) => i.checked).length} erledigt
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAddMealsOpen(true)}>
              <CalendarPlus className="size-4" />
              Mahlzeiten hinzufügen
            </Button>
            <Button variant="outline" onClick={() => setAddItemOpen(true)}>
              <Plus className="size-4" />
              Artikel hinzufügen
            </Button>
          </div>
          <SupermarketFilter
            value={supermarketId}
            supermarkets={supermarkets}
            onChange={persistSupermarket}
          />
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center text-sm text-[var(--color-muted-fg)]">
          Noch keine Artikel auf der Liste. Füge Mahlzeiten aus dem Plan hinzu
          oder einen Artikel manuell.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map((group) => (
            <section key={group.key} className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
                {group.label}
              </h2>
              <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)]">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <ShoppingItemRow
                      item={item}
                      onToggle={onToggleCheck}
                      onPatch={onPatch}
                      onDelete={onDelete}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <AddItemDialog
        open={addItemOpen}
        onClose={() => setAddItemOpen(false)}
        onAdded={() => {
          setAddItemOpen(false);
          router.refresh();
        }}
      />
      <AddMealsDialog
        open={addMealsOpen}
        defaultLengthDays={defaultLengthDays}
        today={today}
        onClose={() => setAddMealsOpen(false)}
        onAdded={() => {
          setAddMealsOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}

type Group = { key: string; label: string; items: ShoppingItemView[] };

function groupItems(
  items: ShoppingItemView[],
  supermarketId: number | null,
  supermarkets: SupermarketSummary[],
): Group[] {
  // Two stacks: open items first (grouped per the active sort), then checked
  // items as a single bottom group. Within each section the checked items
  // stay in place (per spec they don't move to the bottom of the list — they
  // sink to the bottom of *their own group* via the strike-through styling).
  const open = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);

  if (supermarketId == null) {
    open.sort((a, b) => a.name.localeCompare(b.name, "de"));
    const groups: Group[] = [];
    if (open.length > 0)
      groups.push({ key: "all-open", label: "Offene Artikel", items: open });
    if (checked.length > 0)
      groups.push({ key: "checked", label: "Erledigt", items: checked });
    return groups;
  }

  const sm = supermarkets.find((s) => s.id === supermarketId);
  if (!sm) {
    return groupItems(items, null, supermarkets);
  }
  const orderByCategory = new Map(
    sm.categories.map((c) => [c.categoryId, c.sortOrder]),
  );

  const byCategory = new Map<number | null, ShoppingItemView[]>();
  for (const item of open) {
    const key = orderByCategory.has(item.categoryId ?? -1)
      ? item.categoryId
      : null;
    const arr = byCategory.get(key) ?? [];
    arr.push(item);
    byCategory.set(key, arr);
  }
  for (const [, arr] of byCategory) {
    arr.sort((a, b) => a.name.localeCompare(b.name, "de"));
  }

  const groups: Group[] = [];
  const ordered = Array.from(byCategory.entries())
    .filter(([key]) => key != null)
    .sort(([a], [b]) => {
      const ao = orderByCategory.get(a as number) ?? 0;
      const bo = orderByCategory.get(b as number) ?? 0;
      return ao - bo;
    });
  for (const [, arr] of ordered) {
    const catName = arr[0].categoryName ?? "Ohne Kategorie";
    groups.push({
      key: `cat-${arr[0].categoryId ?? "none"}`,
      label: catName,
      items: arr,
    });
  }
  const uncategorized = byCategory.get(null);
  if (uncategorized && uncategorized.length > 0) {
    groups.push({ key: "uncategorized", label: "Sonstiges", items: uncategorized });
  }
  if (checked.length > 0)
    groups.push({ key: "checked", label: "Erledigt", items: checked });
  return groups;
}
