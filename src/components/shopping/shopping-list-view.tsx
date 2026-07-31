"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CalendarPlus,
  EyeOff,
  ListPlus,
  PackageCheck,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger, TabCount } from "@/components/ui/tabs";
import { RecipePreviewDialog } from "@/components/planner/recipe-preview-dialog";
import type { ShoppingItemView } from "@/lib/shopping/items";
import {
  groupShoppingItems,
  type SupermarketSummary,
} from "@/lib/shopping/group-items";
import { countNeededItemsPerSupermarket } from "@/lib/shopping/supermarket-availability";
import { resolveSupermarketDeepLink } from "@/lib/shopping/supermarket-deep-link";
import { ShoppingItemRow } from "./shopping-item-row";
import { MarkRecipeUpdateDialog } from "./mark-recipe-update-dialog";
import { ShoppingDoneState } from "./shopping-done";
import { AddItemDialog } from "./add-item-dialog";
import { AddMealsDialog } from "./add-meals-dialog";
import { AddStaplesDialog } from "./add-staples-dialog";
import { AddDueSoonDialog } from "./add-due-soon-dialog";
import { SupermarketFilter } from "./supermarket-filter";
import { ClearListDialog } from "./clear-list-dialog";
import { EditItemDialog } from "./edit-item-dialog";
import { StockCheckDialog } from "./stock-check-dialog";
import {
  addItemAmount as apiAddAmount,
  clearItemStock as apiClearStock,
  clearListSelective as apiClearList,
  deleteItem as apiDelete,
  deleteManualAmount as apiDeleteManual,
  deleteSource as apiDeleteSource,
  deleteStapleSource as apiDeleteStapleSource,
  fetchItems,
  markRecipesNeedUpdate as apiMarkRecipesNeedUpdate,
  patchItem as apiPatch,
  setItemStock as apiSetStock,
  setManualAmountQuantity as apiSetManualQty,
  setSourceQuantity as apiSetSourceQty,
  setUnavailable as apiSetUnavailable,
} from "./api";
import { EditArticleDialog } from "@/components/articles/edit-article-dialog";
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

export type { SupermarketSummary } from "@/lib/shopping/group-items";

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
  const [addDueSoonOpen, setAddDueSoonOpen] = React.useState(false);
  const [previewRecipeId, setPreviewRecipeId] = React.useState<number | null>(null);
  // The item whose recipes are being picked for "needs update" (multi-recipe
  // items only; single-recipe items mark directly).
  const [markUpdateItem, setMarkUpdateItem] = React.useState<ShoppingItemView | null>(
    null,
  );
  const [clearOpen, setClearOpen] = React.useState(false);
  const [stockCheckOpen, setStockCheckOpen] = React.useState(false);
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
  // Which list the user is looking at: still-to-buy ("open") or already
  // checked off ("checked"). Checking the last item leaves them on "open" so
  // they land on the celebratory done screen rather than an empty list.
  const [activeTab, setActiveTab] = React.useState<
    "open" | "checked" | "unavailable"
  >("open");

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
    // A `?supermarket=` deep link (e.g. a Home Assistant notification) takes
    // precedence over the stored default: a valid id selects + persists that
    // store; `all` (or an empty value) resets to "Alle Supermärkte" and clears
    // the stored default; with no param the stored default is restored.
    const fromUrl = new URLSearchParams(window.location.search).get("supermarket");
    const action = resolveSupermarketDeepLink(
      fromUrl,
      window.localStorage.getItem(STORAGE_KEY),
      (id) => supermarkets.some((s) => s.id === id),
    );
    if (action.id !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupermarketId(action.id);
    }
    if (action.storage === "write" && action.id != null) {
      window.localStorage.setItem(STORAGE_KEY, String(action.id));
    } else if (action.storage === "clear") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [supermarkets]);

  function persistSupermarket(id: number | null) {
    setSupermarketId(id);
    // The "Nicht verfügbar" tab only exists while a store is selected; fall
    // back to "Offen" when the store is cleared from under it.
    if (id == null) setActiveTab((t) => (t === "unavailable" ? "open" : t));
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

  async function onSetStock(
    id: number,
    stock: { quantity: number | null; unitId: number | null },
  ) {
    try {
      const updated = await apiSetStock(id, stock);
      // null = the stock covers the whole demand; the server removed the item.
      setItems((prev) =>
        updated == null
          ? prev.filter((i) => i.id !== id)
          : prev.map((i) => (i.id === updated.id ? updated : i)),
      );
    } catch {
      router.refresh();
    }
  }

  async function onClearStock(id: number) {
    try {
      const updated = await apiClearStock(id);
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
    () => groupShoppingItems(items, supermarketId, supermarkets),
    [items, supermarketId, supermarkets],
  );

  // Leaving the "Nicht verfügbar" tab once its last article has been made
  // available again (the tab trigger is gone, so its content would orphan).
  React.useEffect(() => {
    if (activeTab === "unavailable" && grouped.unavailableHere.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab("open");
    }
  }, [activeTab, grouped.unavailableHere.length]);

  // How many still-needed items each supermarket carries — drives the count
  // shown next to each store in the filter so it's easy to see which stores
  // still have something to buy.
  const neededCounts = React.useMemo(
    () => countNeededItemsPerSupermarket(items, supermarkets),
    [items, supermarkets],
  );

  // Stores that still have unchecked items, most-loaded first. Shown on the
  // done screen as "next stops" — when the current store is cleared, these are
  // by definition other stores, so tapping one switches the filter there.
  const nextStops = React.useMemo(
    () =>
      supermarkets
        .map((s) => ({ id: s.id, name: s.name, count: neededCounts.get(s.id) ?? 0 }))
        .filter((s) => s.count > 0)
        .sort(
          (a, b) =>
            b.count - a.count || a.name.localeCompare(b.name, "de", { sensitivity: "base" }),
        ),
    [supermarkets, neededCounts],
  );

  const renderRow = (item: ShoppingItemView, trailingAction?: React.ReactNode) => (
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
        onMarkRecipesNeedUpdate={(ids) => void apiMarkRecipesNeedUpdate(ids)}
        onRequestMarkRecipeUpdate={setMarkUpdateItem}
        disabledOffline={disabledOffline}
        trailingAction={trailingAction}
      />
    </li>
  );

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

      {/* Action buttons — common to both tabs, so they sit above the tab bar. */}
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
          onClick={() => setAddDueSoonOpen(true)}
          aria-label="Fällige Zutaten hinzufügen"
          disabled={disabledOffline}
        >
          <CalendarClock className="size-4" />
          <span className="hidden sm:inline">Fällige Zutaten…</span>
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
            variant="outline"
            onClick={() => setStockCheckOpen(true)}
            aria-label="Auf Lager prüfen"
            disabled={disabledOffline}
          >
            <PackageCheck className="size-4" />
            <span className="hidden sm:inline">Auf Lager…</span>
          </Button>
        ) : null}
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
        <Tabs
          value={activeTab}
          onValueChange={(v) =>
            setActiveTab(v as "open" | "checked" | "unavailable")
          }
        >
          {/* Sticky shelf: on mobile the supermarket select stacks below the
              tabs (no room beside them); from sm up it sits pinned to the right.
              Sits below the AppShell topbar (h-16) at z-20 so it doesn't
              outrank it. */}
          <div className="sticky top-16 z-20 -mx-4 flex flex-col gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-bg)]/80 sm:flex-row sm:items-center sm:justify-between md:-mx-6 md:gap-3 md:px-6">
            <TabsList>
              <TabsTrigger value="open">
                Offen
                <TabCount count={grouped.visibleOpen} />
              </TabsTrigger>
              <TabsTrigger value="checked">
                Erledigt
                <TabCount count={grouped.visibleChecked} />
              </TabsTrigger>
              {supermarketId != null && grouped.unavailableHere.length > 0 ? (
                <TabsTrigger value="unavailable">
                  Nicht verfügbar
                  <TabCount count={grouped.unavailableHere.length} />
                </TabsTrigger>
              ) : null}
            </TabsList>
            <div className="shrink-0">
              <SupermarketFilter
                value={supermarketId}
                supermarkets={supermarkets}
                neededCounts={neededCounts}
                onChange={persistSupermarket}
              />
            </div>
          </div>

          <TabsContent value="open" className="mt-4 flex flex-col gap-6">
            {grouped.visibleOpen === 0 ? (
              <ShoppingDoneState
                checkedCount={grouped.visibleChecked}
                nextStops={nextStops}
                onShowChecked={() => setActiveTab("checked")}
                onPickStore={persistSupermarket}
              />
            ) : (
              <>
                {grouped.hiddenOpen > 0 ? (
                  <HiddenByStoreBanner
                    count={grouped.hiddenOpen}
                    onShowAll={() => persistSupermarket(null)}
                  />
                ) : null}
                {grouped.openGroups.map((group) => (
                  <section key={group.key} className="flex flex-col gap-2">
                    <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
                      {group.label}
                    </h2>
                    <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)]">
                      {group.items.map((i) => renderRow(i))}
                    </ul>
                  </section>
                ))}
              </>
            )}
          </TabsContent>

          <TabsContent value="checked" className="mt-4 flex flex-col gap-6">
            {grouped.hiddenChecked > 0 ? (
              <HiddenByStoreBanner
                count={grouped.hiddenChecked}
                onShowAll={() => persistSupermarket(null)}
              />
            ) : null}
            {grouped.visibleChecked === 0 ? (
              <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center text-sm text-[var(--color-muted-fg)]">
                Noch nichts abgehakt.
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] opacity-70">
                {grouped.checkedItems.map((i) => renderRow(i))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="unavailable" className="mt-4 flex flex-col gap-3">
            <p className="text-sm text-[var(--color-muted-fg)]">
              Diese Artikel hast du hier als nicht verfügbar markiert – kauf sie
              woanders. Hebe die Markierung auf, um sie wieder einzublenden.
            </p>
            <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)]">
              {grouped.unavailableHere.map((item) =>
                renderRow(
                  item,
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={disabledOffline || supermarketId == null}
                    onClick={() =>
                      supermarketId != null
                        ? void onToggleUnavailable(item, supermarketId)
                        : undefined
                    }
                  >
                    <RotateCcw className="mr-2 size-4" />
                    <span className="hidden sm:inline">Hier verfügbar machen</span>
                    <span className="sm:hidden">Verfügbar</span>
                  </Button>,
                ),
              )}
            </ul>
          </TabsContent>
        </Tabs>
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
      <AddStaplesDialog
        open={addStaplesOpen}
        onClose={() => setAddStaplesOpen(false)}
        onAdded={() => {
          setAddStaplesOpen(false);
          router.refresh();
        }}
      />
      <AddDueSoonDialog
        open={addDueSoonOpen}
        onClose={() => setAddDueSoonOpen(false)}
        onAdded={() => {
          setAddDueSoonOpen(false);
          router.refresh();
        }}
      />
      <RecipePreviewDialog
        recipeId={previewRecipeId}
        onClose={() => setPreviewRecipeId(null)}
      />
      <MarkRecipeUpdateDialog
        item={markUpdateItem}
        onClose={() => setMarkUpdateItem(null)}
        onConfirm={(ids) => void apiMarkRecipesNeedUpdate(ids)}
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
        onSetStock={onSetStock}
        onClearStock={onClearStock}
      />
      <StockCheckDialog
        open={stockCheckOpen}
        items={items}
        onClose={() => setStockCheckOpen(false)}
        onSaved={(updated) => {
          setItems(updated);
          setStockCheckOpen(false);
        }}
      />
      {editingArticleId != null ? (
        <EditArticleDialog
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

/**
 * Banner shown above a tab's list when the active supermarket filter hides
 * some of that tab's items, with a shortcut to clear the filter.
 */
function HiddenByStoreBanner({
  count,
  onShowAll,
}: {
  count: number;
  onShowAll: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--color-accent)]/40 bg-[color-mix(in_srgb,var(--color-accent),transparent_92%)] px-4 py-3 text-sm text-[var(--color-fg)]"
    >
      <span className="inline-flex items-center gap-2">
        <EyeOff className="size-4 text-[var(--color-accent)]" />
        <span>
          <strong className="font-semibold">
            {count} {count === 1 ? "Artikel ist" : "Artikel sind"}
          </strong>{" "}
          durch den Supermarkt-Filter ausgeblendet.
        </span>
      </span>
      <Button variant="outline" size="sm" onClick={onShowAll}>
        Alle anzeigen
      </Button>
    </div>
  );
}

