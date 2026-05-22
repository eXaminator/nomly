"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecipePreviewDialog } from "@/components/planner/recipe-preview-dialog";
import { cn } from "@/lib/cn";
import type { ShoppingItemView } from "@/lib/shopping/items";
import { ShoppingItemRow } from "./shopping-item-row";
import { AddItemDialog } from "./add-item-dialog";
import { AddMealsDialog } from "./add-meals-dialog";
import { SupermarketFilter } from "./supermarket-filter";
import {
  clearAll as apiClearAll,
  deleteItem as apiDelete,
  patchItem as apiPatch,
  setUnavailable as apiSetUnavailable,
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
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setItems(initialItems), [initialItems]);
  const [supermarketId, setSupermarketId] = React.useState<number | null>(null);
  const [addItemOpen, setAddItemOpen] = React.useState(false);
  const [addMealsOpen, setAddMealsOpen] = React.useState(false);
  const [previewRecipeId, setPreviewRecipeId] = React.useState<number | null>(null);
  const [confirmingClear, setConfirmingClear] = React.useState(false);

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

  async function onClearAll() {
    setConfirmingClear(false);
    const prev = items;
    setItems([]);
    try {
      await apiClearAll();
      router.refresh();
    } catch {
      setItems(prev);
      router.refresh();
    }
  }

  async function onToggleUnavailable(item: ShoppingItemView, supermarketId: number) {
    const isUnavailable = item.unavailableSupermarketIds.includes(supermarketId);
    const next = !isUnavailable;
    // Optimistic toggle so the row chip flips immediately.
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== item.id) return i;
        const set = new Set(i.unavailableSupermarketIds);
        if (next) set.add(supermarketId);
        else set.delete(supermarketId);
        return { ...i, unavailableSupermarketIds: Array.from(set) };
      }),
    );
    try {
      await apiSetUnavailable(item.refType, item.refId, supermarketId, next);
    } catch {
      router.refresh();
    }
  }

  const grouped = React.useMemo(
    () => groupByCategory(items, supermarketId, supermarkets),
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
            {(() => {
              const openTotal = items.filter((i) => !i.checked).length;
              const checkedTotal = items.filter((i) => i.checked).length;
              const visibleOpen = openTotal - grouped.hiddenByStore;
              const filterActive = supermarketId != null && grouped.hiddenByStore > 0;
              return (
                <>
                  {filterActive ? (
                    <>
                      <strong className="font-semibold text-[var(--color-fg)]">
                        {visibleOpen}
                      </strong>{" "}
                      von {openTotal} offen
                    </>
                  ) : (
                    <>
                      <strong className="font-semibold text-[var(--color-fg)]">
                        {openTotal}
                      </strong>{" "}
                      offen
                    </>
                  )}
                  {" · "}
                  {checkedTotal} erledigt
                </>
              );
            })()}
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
            {items.length > 0 ? (
              confirmingClear ? (
                <div className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-danger)] px-3 py-1 text-sm">
                  <span className="text-[var(--color-fg)]">Liste leeren?</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingClear(false)}
                  >
                    Abbrechen
                  </Button>
                  <Button variant="danger" size="sm" onClick={onClearAll}>
                    Leeren
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  className="text-[var(--color-danger)]"
                  onClick={() => setConfirmingClear(true)}
                >
                  <Trash2 className="size-4" />
                  Liste leeren
                </Button>
              )
            ) : null}
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
          {grouped.groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-2">
              <h2
                className={cn(
                  "text-xs font-medium uppercase tracking-wider",
                  group.muted
                    ? "text-[var(--color-muted-fg)]/60"
                    : "text-[var(--color-muted-fg)]",
                )}
              >
                {group.label}
              </h2>
              <ul
                className={cn(
                  "flex flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)]",
                  group.muted && "opacity-60",
                )}
              >
                {group.items.map((item) => (
                  <li key={item.id}>
                    <ShoppingItemRow
                      item={item}
                      activeSupermarketId={supermarketId}
                      onPreviewRecipe={(id) => setPreviewRecipeId(id)}
                      onToggle={onToggleCheck}
                      onPatch={onPatch}
                      onDelete={onDelete}
                      onToggleUnavailable={onToggleUnavailable}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {grouped.hiddenByStore > 0 ? (
            <p className="text-xs text-[var(--color-muted-fg)]">
              {grouped.hiddenByStore}{" "}
              {grouped.hiddenByStore === 1 ? "Artikel" : "Artikel"} ausgeblendet
              — nicht in diesem Supermarkt erhältlich oder andere Kategorie.
            </p>
          ) : null}
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
      <RecipePreviewDialog
        recipeId={previewRecipeId}
        onClose={() => setPreviewRecipeId(null)}
      />
    </div>
  );
}

type Group = {
  key: string;
  label: string;
  items: ShoppingItemView[];
  /** Set on the trailing "Erledigt" sink group so it renders muted. */
  muted?: boolean;
};

type GroupedItems = {
  groups: Group[];
  /** When a supermarket filter is active, items filtered out by the store
   *  (unavailable here or in a category this store doesn't carry). 0 when
   *  no filter is active. */
  hiddenByStore: number;
};

function groupByCategory(
  items: ShoppingItemView[],
  supermarketId: number | null,
  supermarkets: SupermarketSummary[],
): GroupedItems {
  const sm = supermarketId != null
    ? supermarkets.find((s) => s.id === supermarketId) ?? null
    : null;
  const orderByCategory = sm
    ? new Map(sm.categories.map((c) => [c.categoryId, c.sortOrder]))
    : null;
  const allowedCategoryIds = sm
    ? new Set(sm.categories.map((c) => c.categoryId))
    : null;

  const open: ShoppingItemView[] = [];
  const checked: ShoppingItemView[] = [];
  let hiddenByStore = 0;
  for (const item of items) {
    if (item.checked) {
      checked.push(item);
      continue;
    }
    if (supermarketId != null) {
      // Marked as not carried here → hide entirely. Applies to uncategorized
      // items too — the user opted them out explicitly.
      if (item.unavailableSupermarketIds.includes(supermarketId)) {
        hiddenByStore += 1;
        continue;
      }
      // Category exists but this supermarket doesn't carry it → hide. Items
      // without a category always pass through (the user hasn't tagged them
      // either way; show them so they aren't accidentally forgotten).
      if (
        item.categoryId != null &&
        allowedCategoryIds != null &&
        !allowedCategoryIds.has(item.categoryId)
      ) {
        hiddenByStore += 1;
        continue;
      }
    }
    open.push(item);
  }

  type Bucket = { categoryId: number | null; categoryName: string; items: ShoppingItemView[] };
  const buckets = new Map<number | "none", Bucket>();
  for (const item of open) {
    const key: number | "none" = item.categoryId ?? "none";
    const b = buckets.get(key) ?? {
      categoryId: item.categoryId,
      categoryName: item.categoryName ?? "Ohne Kategorie",
      items: [],
    };
    b.items.push(item);
    buckets.set(key, b);
  }
  for (const b of buckets.values()) {
    b.items.sort((a, b2) =>
      a.name.localeCompare(b2.name, "de", { sensitivity: "base" }),
    );
  }

  // Uncategorized always sinks to the bottom of the open section, regardless
  // of whether a supermarket filter is active.
  const ordered = Array.from(buckets.values()).sort((a, b) => {
    if (a.categoryId == null && b.categoryId != null) return 1;
    if (a.categoryId != null && b.categoryId == null) return -1;
    if (orderByCategory) {
      const ao = a.categoryId != null ? orderByCategory.get(a.categoryId) : undefined;
      const bo = b.categoryId != null ? orderByCategory.get(b.categoryId) : undefined;
      if (ao != null && bo != null) return ao - bo;
      if (ao != null) return -1;
      if (bo != null) return 1;
    }
    return a.categoryName.localeCompare(b.categoryName, "de", { sensitivity: "base" });
  });

  const groups: Group[] = ordered.map((b) => ({
    key: `cat-${b.categoryId ?? "none"}`,
    label: b.categoryName,
    items: b.items,
  }));

  if (checked.length > 0) {
    groups.push({ key: "checked", label: "Erledigt", items: checked, muted: true });
  }
  return { groups, hiddenByStore };
}

