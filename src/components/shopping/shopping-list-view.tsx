"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, EyeOff, Plus, RotateCcw, Trash2 } from "lucide-react";
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
  setItemAmount as apiSetAmount,
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
  // Stack of item ids in the order they were checked off this session. The
  // header's "Rückgängig" button pops one at a time. We don't persist this
  // across reloads on purpose — undo is meant for "wait, I already had that"
  // moments while shopping, not for time travel.
  const [recentChecks, setRecentChecks] = React.useState<number[]>([]);

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
    setRecentChecks((prev) => {
      const without = prev.filter((id) => id !== item.id);
      return nextChecked ? [...without, item.id] : without;
    });
    try {
      const updated = await apiPatch(item.id, { checked: nextChecked });
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch {
      router.refresh();
    }
  }

  async function onUndoLastCheck() {
    // Pop the most recent id, skipping any that are no longer checked or no
    // longer on the list (deleted, swept, etc.). Mutates a local copy of the
    // stack so we only setState once.
    const stack = [...recentChecks];
    let target: ShoppingItemView | null = null;
    while (stack.length > 0) {
      const id = stack.pop()!;
      const item = items.find((i) => i.id === id);
      if (item && item.checked) {
        target = item;
        break;
      }
    }
    setRecentChecks(stack);
    if (!target) return;
    const id = target.id;
    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, checked: false, checkedAt: null } : i,
      ),
    );
    try {
      const updated = await apiPatch(id, { checked: false });
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch {
      router.refresh();
    }
  }

  const undoAvailable = React.useMemo(
    () => recentChecks.some((id) => items.find((i) => i.id === id)?.checked),
    [recentChecks, items],
  );

  async function onPatchNote(id: number, note: string | null) {
    try {
      const updated = await apiPatch(id, { note });
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch {
      router.refresh();
    }
  }

  async function onSetAmount(
    id: number,
    amount: { quantity: number | null; unitId: number | null },
  ) {
    try {
      const updated = await apiSetAmount(id, amount);
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

  const openTotal = items.filter((i) => !i.checked).length;
  const checkedTotal = items.filter((i) => i.checked).length;
  const visibleOpen = openTotal - grouped.hiddenByStore;
  const filterActive = supermarketId != null && grouped.hiddenByStore > 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Einkaufsliste</h1>

      {/* Sticky shelf: undo on the left; counter + supermarket select on the
          right. Sits below the AppShell topbar (h-16) at z-20 so it doesn't
          outrank it. */}
      <div className="sticky top-16 z-20 -mx-4 flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-bg)]/80 md:-mx-6 md:gap-3 md:px-6">
        <Button
          variant="outline"
          size="sm"
          onClick={onUndoLastCheck}
          disabled={!undoAvailable}
          aria-label="Letzten Haken zurücknehmen"
          title="Letzten Haken zurücknehmen"
          className="shrink-0"
        >
          <RotateCcw className="size-4" />
          <span className="hidden sm:inline">Rückgängig</span>
        </Button>
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <span className="whitespace-nowrap text-sm text-[var(--color-muted-fg)]">
            {filterActive ? (
              <>
                <strong className="font-semibold text-[var(--color-fg)]">
                  {visibleOpen}
                </strong>
                <span className="hidden sm:inline"> von </span>
                <span className="sm:hidden">/</span>
                {openTotal} offen
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
          </span>
          <SupermarketFilter
            value={supermarketId}
            supermarkets={supermarkets}
            onChange={persistSupermarket}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setAddMealsOpen(true)} aria-label="Mahlzeiten hinzufügen">
          <CalendarPlus className="size-4" />
          <span className="hidden sm:inline">Mahlzeiten hinzufügen</span>
        </Button>
        <Button
          variant="outline"
          onClick={() => setAddItemOpen(true)}
          aria-label="Artikel hinzufügen"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Artikel hinzufügen</span>
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
              aria-label="Liste leeren"
            >
              <Trash2 className="size-4" />
              <span className="hidden sm:inline">Liste leeren</span>
            </Button>
          )
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center text-sm text-[var(--color-muted-fg)]">
          Noch keine Artikel auf der Liste. Füge Mahlzeiten aus dem Plan hinzu
          oder einen Artikel manuell.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.hiddenByStore > 0 && supermarketId != null ? (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--color-accent)]/40 bg-[color-mix(in_srgb,var(--color-accent),transparent_92%)] px-4 py-3 text-sm text-[var(--color-fg)]"
            >
              <span className="inline-flex items-center gap-2">
                <EyeOff className="size-4 text-[var(--color-accent)]" />
                <span>
                  <strong className="font-semibold">
                    {grouped.hiddenByStore}{" "}
                    {grouped.hiddenByStore === 1 ? "Artikel ist" : "Artikel sind"}
                  </strong>{" "}
                  durch den Supermarkt-Filter ausgeblendet.
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => persistSupermarket(null)}
              >
                Alle anzeigen
              </Button>
            </div>
          ) : null}
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
                      onSetAmount={onSetAmount}
                      onPatchNote={onPatchNote}
                      onDelete={onDelete}
                      onToggleUnavailable={onToggleUnavailable}
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

