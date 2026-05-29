"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, EyeOff, ListPlus, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecipePreviewDialog } from "@/components/planner/recipe-preview-dialog";
import { cn } from "@/lib/cn";
import type { ShoppingItemView } from "@/lib/shopping/items";
import { countNeededItemsPerSupermarket } from "@/lib/shopping/supermarket-availability";
import { ShoppingItemRow } from "./shopping-item-row";
import { AddItemDialog } from "./add-item-dialog";
import { AddMealsDialog } from "./add-meals-dialog";
import { AddStapleGroupDialog } from "./add-staple-group-dialog";
import { SupermarketFilter } from "./supermarket-filter";
import { ClearListDialog } from "./clear-list-dialog";
import { EditItemDialog } from "./edit-item-dialog";
import {
  addItemAmount as apiAddAmount,
  clearListSelective as apiClearList,
  deleteItem as apiDelete,
  deleteManualAmount as apiDeleteManual,
  deleteSource as apiDeleteSource,
  deleteStapleSource as apiDeleteStapleSource,
  fetchItems,
  patchItem as apiPatch,
  setManualAmountQuantity as apiSetManualQty,
  setSourceQuantity as apiSetSourceQty,
  setUnavailable as apiSetUnavailable,
} from "./api";
import { EditArticleDrawer } from "@/components/articles/edit-article-drawer";
import { useShoppingRealtime } from "./use-shopping-realtime";
import {
  getConnectivity,
  subscribeConnectivity,
} from "@/lib/shopping/offline/connectivity";
import { openOfflineDb } from "@/lib/shopping/offline/db";
import {
  hydrateFromIDB,
  readItemsFromIDB,
  reconcileFromServer,
  toggleItemOptimistic,
} from "@/lib/shopping/offline/store";
import { kickSync } from "@/lib/shopping/offline/sync";

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
  defaultStart: string;
};

export function ShoppingListView({
  initialItems,
  supermarkets,
  defaultLengthDays,
  defaultStart,
}: Props) {
  const router = useRouter();
  const [items, setItems] = React.useState(initialItems);
  // NOTE: we deliberately do NOT re-sync `items` from `initialItems` on
  // every render. IDB is the source of truth on the client; treating
  // `initialItems` as authoritative would let a cached SSR snapshot (e.g.,
  // the data-less offline shell) overwrite live local state. The mount
  // effect below seeds IDB from `initialItems` only when IDB is empty.
  const [supermarketId, setSupermarketId] = React.useState<number | null>(null);
  const [addItemOpen, setAddItemOpen] = React.useState(false);
  const [addMealsOpen, setAddMealsOpen] = React.useState(false);
  const [addStaplesOpen, setAddStaplesOpen] = React.useState(false);
  const [previewRecipeId, setPreviewRecipeId] = React.useState<number | null>(null);
  const [clearOpen, setClearOpen] = React.useState(false);
  // Identify by id so the dialog body re-keys to fresh state when a
  // different item is opened. The actual item passed in comes from the
  // live `items` array so quick updates from other paths flow through.
  const [editingItemId, setEditingItemId] = React.useState<number | null>(null);
  const [editingArticleId, setEditingArticleId] = React.useState<number | null>(
    null,
  );
  const editingItem = React.useMemo(
    () => (editingItemId != null ? items.find((i) => i.id === editingItemId) ?? null : null),
    [editingItemId, items],
  );
  // Stack of item ids in the order they were checked off this session. The
  // header's "Rückgängig" button pops one at a time. We don't persist this
  // across reloads on purpose — undo is meant for "wait, I already had that"
  // moments while shopping, not for time travel.
  const [recentChecks, setRecentChecks] = React.useState<number[]>([]);

  const [connectivity, setConnectivityState] = React.useState(getConnectivity());

  // The connectivity watcher is owned app-wide by the header
  // (ConnectivityStatus); here we just subscribe to read the state.
  React.useEffect(() => subscribeConnectivity(setConnectivityState), []);

  // Realtime sync: when another device changes the list, refetch and replace.
  // Only active while online (the WS hook handles connect/reconnect).
  useShoppingRealtime(
    React.useCallback(async () => {
      try {
        const { items: fresh } = await fetchItems();
        const merged = await reconcileFromServer(fresh);
        setItems(merged);
      } catch {
        // Transient — connectivity watcher will flip if it's real.
      }
    }, []),
  );

  // Mount: hydrate UI from IDB, mirror supermarkets cache, then attempt
  // a sync drain only if connectivity has already resolved to online.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const merged = await hydrateFromIDB(initialItems);
      if (cancelled) return;
      setItems(merged);
      const db = await openOfflineDb();
      const wtx = db.transaction(["supermarkets"], "readwrite");
      await wtx.objectStore("supermarkets").clear();
      for (const s of supermarkets) await wtx.objectStore("supermarkets").put(s);
      await wtx.done;
      if (getConnectivity() === "online") await kickSync();
    })().catch((err) => console.warn("offline init failed", err));
    return () => {
      cancelled = true;
    };
  }, [initialItems, supermarkets]);

  const prevConnectivityRef = React.useRef(connectivity);
  React.useEffect(() => {
    const prev = prevConnectivityRef.current;
    prevConnectivityRef.current = connectivity;
    if (connectivity !== "online") return;
    if (prev === "online") return; // not a transition
    void (async () => {
      try {
        const { items: fresh } = await fetchItems();
        const merged = await reconcileFromServer(fresh);
        setItems(merged);
      } catch {
        // Probe says online but the request failed; the watcher will flip
        // us back on the next probe.
      }
      await kickSync();
      const refreshed = await readItemsFromIDB();
      setItems(refreshed);
    })();
  }, [connectivity]);

  React.useEffect(() => {
    // A `?supermarket=<id>` deep link (e.g. the Home Assistant geofence
    // notification) takes precedence over the stored default. A deep-linked
    // store is also persisted, so a later reload keeps it.
    const fromUrl = new URLSearchParams(window.location.search).get("supermarket");
    const candidate = fromUrl ?? window.localStorage.getItem(STORAGE_KEY);
    if (candidate == null) return;
    const n = Number.parseInt(candidate, 10);
    if (Number.isFinite(n) && supermarkets.some((s) => s.id === n)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupermarketId(n);
      if (fromUrl != null) window.localStorage.setItem(STORAGE_KEY, String(n));
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
    // Optimistic local toggle + queued mutation; the sync engine drives the network.
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
    await toggleItemOptimistic(item.id, nextChecked);
    if (connectivity === "online") {
      await kickSync();
      const refreshed = await readItemsFromIDB();
      setItems(refreshed);
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

  const disabledOffline =
    connectivity === "offline" || connectivity === "sessionExpired";

  async function onPatchNote(id: number, note: string | null) {
    try {
      const updated = await apiPatch(id, { note });
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch {
      router.refresh();
    }
  }

  async function onSetSourceQuantity(
    id: number,
    sourceId: number,
    quantity: number | null,
  ) {
    try {
      const updated = await apiSetSourceQty(id, sourceId, quantity);
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch {
      router.refresh();
    }
  }

  async function onSetManualAmountQuantity(
    id: number,
    amountId: number,
    quantity: number | null,
  ) {
    try {
      const updated = await apiSetManualQty(id, amountId, quantity);
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch {
      router.refresh();
    }
  }

  async function onDeleteSource(id: number, sourceId: number) {
    try {
      const updated = await apiDeleteSource(id, sourceId);
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch {
      router.refresh();
    }
  }

  async function onDeleteManualAmount(id: number, amountId: number) {
    try {
      const updated = await apiDeleteManual(id, amountId);
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch {
      router.refresh();
    }
  }

  async function onAddAmount(
    id: number,
    amount: { quantity: number | null; unitId: number | null },
  ) {
    try {
      const updated = await apiAddAmount(id, amount);
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

  async function onClear(selection: {
    removeAll: boolean;
    mealPlanIds: number[];
    stapleGroupIds: number[];
  }) {
    await apiClearList(selection);
    setClearOpen(false);
    router.refresh();
  }

  async function onDeleteStapleSource(id: number, sourceId: number) {
    try {
      const updated = await apiDeleteStapleSource(id, sourceId);
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch {
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

  // How many still-needed items each supermarket carries — drives the count
  // shown next to each store in the filter so it's easy to see which stores
  // still have something to buy.
  const neededCounts = React.useMemo(
    () => countNeededItemsPerSupermarket(items, supermarkets),
    [items, supermarkets],
  );

  const openTotal = items.filter((i) => !i.checked).length;
  const checkedTotal = items.filter((i) => i.checked).length;
  const visibleOpen = openTotal - grouped.hiddenByStore;
  const filterActive = supermarketId != null && grouped.hiddenByStore > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Title row: headline on the left, undo aligned to its right. */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Einkaufsliste</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={onUndoLastCheck}
          disabled={!undoAvailable || disabledOffline}
          aria-label="Letzten Haken zurücknehmen"
          title="Letzten Haken zurücknehmen"
          className="shrink-0"
        >
          <RotateCcw className="size-4" />
          <span className="hidden sm:inline">Rückgängig</span>
        </Button>
      </div>

      {/* Sticky shelf: counter pinned left, supermarket select pinned right.
          Sits below the AppShell topbar (h-16) at z-20 so it doesn't outrank
          it. */}
      <div className="sticky top-16 z-20 -mx-4 flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-bg)]/80 md:-mx-6 md:gap-3 md:px-6">
        <span className="min-w-0 whitespace-nowrap text-sm text-[var(--color-muted-fg)]">
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
        <div className="shrink-0">
          <SupermarketFilter
            value={supermarketId}
            supermarkets={supermarkets}
            neededCounts={neededCounts}
            onChange={persistSupermarket}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => setAddMealsOpen(true)}
          aria-label="Mahlzeiten hinzufügen"
          disabled={disabledOffline}
        >
          <CalendarPlus className="size-4" />
          <span className="hidden sm:inline">Mahlzeiten hinzufügen</span>
        </Button>
        <Button
          variant="outline"
          onClick={() => setAddStaplesOpen(true)}
          aria-label="Standards hinzufügen"
          disabled={disabledOffline}
        >
          <ListPlus className="size-4" />
          <span className="hidden sm:inline">Standards…</span>
        </Button>
        <Button
          variant="outline"
          onClick={() => setAddItemOpen(true)}
          aria-label="Artikel hinzufügen"
          disabled={disabledOffline}
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Artikel hinzufügen</span>
        </Button>
        {items.length > 0 ? (
          <Button
            variant="ghost"
            className="text-[var(--color-danger)]"
            onClick={() => setClearOpen(true)}
            aria-label="Liste leeren"
            disabled={disabledOffline}
          >
            <Trash2 className="size-4" />
            <span className="hidden sm:inline">Liste leeren</span>
          </Button>
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
                      onEdit={(i) => setEditingItemId(i.id)}
                      onEditArticle={setEditingArticleId}
                      onDelete={onDelete}
                      onToggleUnavailable={onToggleUnavailable}
                      disabledOffline={disabledOffline}
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
        defaultStart={defaultStart}
        onClose={() => setAddMealsOpen(false)}
        onAdded={() => {
          setAddMealsOpen(false);
          router.refresh();
        }}
      />
      <AddStapleGroupDialog
        open={addStaplesOpen}
        onClose={() => setAddStaplesOpen(false)}
        onAdded={() => {
          setAddStaplesOpen(false);
          router.refresh();
        }}
      />
      <RecipePreviewDialog
        recipeId={previewRecipeId}
        onClose={() => setPreviewRecipeId(null)}
      />
      <ClearListDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={onClear}
      />
      <EditItemDialog
        item={editingItem}
        onClose={() => setEditingItemId(null)}
        onAddAmount={onAddAmount}
        onSetSourceQuantity={onSetSourceQuantity}
        onSetManualAmountQuantity={onSetManualAmountQuantity}
        onDeleteSource={onDeleteSource}
        onDeleteStapleSource={onDeleteStapleSource}
        onDeleteManualAmount={onDeleteManualAmount}
        onPatchNote={onPatchNote}
      />
      {editingArticleId != null ? (
        <EditArticleDrawer
          ingredientId={editingArticleId}
          onClose={() => setEditingArticleId(null)}
          onSaved={async () => {
            // The edited article's name/category may show on the row — refetch.
            try {
              const { items: fresh } = await fetchItems();
              setItems(fresh);
            } catch {
              // ignore; realtime/refresh will reconcile
            }
          }}
        />
      ) : null}
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
    // Sort by checkedAt desc so the most-recently-checked item is at the top;
    // items without a checkedAt (legacy or imported) fall to the bottom.
    const checkedSorted = [...checked].sort((a, b) => {
      const aAt = a.checkedAt ?? 0;
      const bAt = b.checkedAt ?? 0;
      return bAt - aAt;
    });
    groups.push({
      key: "checked",
      label: "Erledigt",
      items: checkedSorted,
      muted: true,
    });
  }
  return { groups, hiddenByStore };
}

