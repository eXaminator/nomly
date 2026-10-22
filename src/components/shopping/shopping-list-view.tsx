"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownUp,
  CalendarClock,
  CalendarPlus,
  ChevronDown,
  EyeOff,
  ListPlus,
  PackageCheck,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger, TabCount } from "@/components/ui/tabs";
import { RecipePreviewDialog } from "@/components/planner/recipe-preview-dialog";
import type { ShoppingItemView } from "@/lib/shopping/items";
import {
  groupShoppingItems,
  type ShoppingSortMode,
  type SupermarketSummary,
} from "@/lib/shopping/group-items";
import { localDateIso } from "@/lib/shopping/local-date";
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
  setSkipped as apiSetSkipped,
  setUnavailable as apiSetUnavailable,
} from "./api";
import { EditArticleDialog } from "@/components/articles/edit-article-dialog";
import { useShoppingRealtime } from "./use-shopping-realtime";
import { getConnectivity } from "@/lib/shopping/offline/connectivity";
import { useConnectivity } from "./offline-indicator";
import { openOfflineDb } from "@/lib/shopping/offline/db";
import {
  hydrateFromIDB,
  readItemsFromIDB,
  reconcileFromServer,
  toggleItemOptimistic,
} from "@/lib/shopping/offline/store";
import { kickSync } from "@/lib/shopping/offline/sync";

const STORAGE_KEY = "nomly.shopping.supermarketId";
/** Per-device opt-in for the learned walking order ("learned" | absent). */
const SORT_MODE_KEY = "nomly.shopping.sortMode";

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
  const [sortMode, setSortMode] = React.useState<ShoppingSortMode>("category");
  // The device's calendar day — "gab es hier heute nicht" markers only hide
  // their item on that day. Unknown ("") during SSR/hydration so the server's
  // (possibly differently zoned) day can't cause a mismatch; re-checked every
  // minute so the markers lapse at local midnight without a reload.
  const [today, setToday] = React.useState("");
  React.useEffect(() => {
    const tick = () => setToday(localDateIso());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);
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

  // The connectivity watcher is owned app-wide by the header
  // (ConnectivityStatus); here we just read the state. Via the shared hook, so
  // this cannot drift back into the subscribe-in-effect pattern that loses the
  // first write (see useConnectivity).
  const connectivity = useConnectivity();

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
    if (window.localStorage.getItem(SORT_MODE_KEY) === "learned") {
      setSortMode("learned");
    }
  }, [supermarkets]);

  function toggleSortMode() {
    setSortMode((prev) => {
      const next: ShoppingSortMode = prev === "learned" ? "category" : "learned";
      if (next === "learned") window.localStorage.setItem(SORT_MODE_KEY, "learned");
      else window.localStorage.removeItem(SORT_MODE_KEY);
      return next;
    });
  }

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

  /**
   * Toggles the check. `countAsPurchase: false` checks off without recording a
   * purchase (the swipe-right gesture: "erledigt, aber nicht gekauft").
   */
  async function onToggleCheck(
    item: ShoppingItemView,
    options: { countAsPurchase?: boolean } = {},
  ) {
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
    // The active store rides along so the check-off feeds that store's
    // learned walking order.
    await toggleItemOptimistic(item.id, nextChecked, supermarketId, options);
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

  async function onSetSkipped(
    item: ShoppingItemView,
    storeId: number,
    skipped: boolean,
  ) {
    const on = localDateIso();
    // Optimistic so the row drops out of (or back into) the store view at once.
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== item.id) return i;
        const others = (i.skippedAt ?? []).filter((s) => s.supermarketId !== storeId);
        return {
          ...i,
          skippedAt: skipped ? [...others, { supermarketId: storeId, on }] : others,
        };
      }),
    );
    try {
      await apiSetSkipped(item.id, storeId, skipped ? on : null);
    } catch {
      router.refresh();
    }
  }

  const grouped = React.useMemo(
    () =>
      groupShoppingItems(items, supermarketId, supermarkets, { sortMode, today }),
    [items, supermarketId, supermarkets, sortMode, today],
  );
  const notHereCount = grouped.unavailableHere.length + grouped.skippedHere.length;

  // Leaving the "Nicht verfügbar" tab once its last article has been made
  // available again (the tab trigger is gone, so its content would orphan).
  React.useEffect(() => {
    if (activeTab === "unavailable" && notHereCount === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab("open");
    }
  }, [activeTab, notHereCount]);

  // How many still-needed items each supermarket carries — drives the count
  // shown next to each store in the filter so it's easy to see which stores
  // still have something to buy.
  const neededCounts = React.useMemo(
    () => countNeededItemsPerSupermarket(items, supermarkets, today),
    [items, supermarkets, today],
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
        onToggle={(i) => onToggleCheck(i)}
        onCheckWithoutPurchase={(i) => onToggleCheck(i, { countAsPurchase: false })}
        onEdit={(i) => setEditingItemId(i.id)}
        onEditArticle={setEditingArticleId}
        onDelete={onDelete}
        onToggleUnavailable={onToggleUnavailable}
        onSkipToday={(i, storeId) => onSetSkipped(i, storeId, true)}
        onMarkRecipesNeedUpdate={(ids) => void apiMarkRecipesNeedUpdate(ids)}
        onRequestMarkRecipeUpdate={setMarkUpdateItem}
        disabledOffline={disabledOffline}
        trailingAction={trailingAction}
      />
    </li>
  );

  const learnedWanted = sortMode === "learned" && supermarketId != null;

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as "open" | "checked" | "unavailable")}
      className="flex flex-col gap-4"
    >
      {/* Sticky head: headline + actions, and (with items) tabs + store filter.
          Docks flush under the AppShell topbar (h-16): -mt-6 cancels the
          shell's top padding. z-20 so it never outranks the topbar. */}
      <div className="sticky top-16 z-20 -mx-4 -mt-6 flex flex-col gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 pb-2 pt-4 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-bg)]/80 md:-mx-6 md:px-6">
        <div className="flex items-center justify-between gap-2">
          <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">
            Einkaufsliste
          </h1>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {items.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStockCheckOpen(true)}
                aria-label="Auf Lager prüfen"
                title="Auf Lager prüfen"
                disabled={disabledOffline}
              >
                <PackageCheck className="size-4" />
                <span className="hidden sm:inline">Auf Lager…</span>
              </Button>
            ) : null}
            {items.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-[var(--color-danger)]"
                onClick={() => setClearOpen(true)}
                aria-label="Liste leeren"
                title="Liste leeren"
                disabled={disabledOffline}
              >
                <Trash2 className="size-4" />
                <span className="hidden sm:inline">Liste leeren</span>
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={disabledOffline}>
                <Button size="sm" aria-label="Hinzufügen" title="Hinzufügen">
                  <Plus className="size-4" />
                  <span className="hidden sm:inline">Hinzufügen</span>
                  <ChevronDown className="hidden size-4 sm:inline" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setAddMealsOpen(true)}>
                  <CalendarPlus className="mr-2 size-4" />
                  Mahlzeiten hinzufügen
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAddStaplesOpen(true)}>
                  <ListPlus className="mr-2 size-4" />
                  Standards…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAddDueSoonOpen(true)}>
                  <CalendarClock className="mr-2 size-4" />
                  Fällige Zutaten…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAddItemOpen(true)}>
                  <Plus className="mr-2 size-4" />
                  Artikel hinzufügen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Undo stays the right-most action, where it has always been. */}
            <Button
              variant="outline"
              size="sm"
              onClick={onUndoLastCheck}
              disabled={!undoAvailable || disabledOffline}
              aria-label="Letzten Haken zurücknehmen"
              title="Letzten Haken zurücknehmen"
            >
              <RotateCcw className="size-4" />
              <span className="hidden sm:inline">Rückgängig</span>
            </Button>
          </div>
        </div>

        {items.length > 0 ? (
          // On mobile the store filter stacks below the tabs (no room beside
          // them); from sm up it sits pinned to the right.
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between md:gap-3">
            <TabsList>
              <TabsTrigger value="open">
                Offen
                <TabCount count={grouped.visibleOpen} />
              </TabsTrigger>
              <TabsTrigger value="checked">
                Erledigt
                <TabCount count={grouped.visibleChecked} />
              </TabsTrigger>
              {supermarketId != null && notHereCount > 0 ? (
                <TabsTrigger value="unavailable">
                  Nicht verfügbar
                  <TabCount count={notHereCount} />
                </TabsTrigger>
              ) : null}
            </TabsList>
            <div className="flex items-center gap-1 sm:shrink-0">
              {/* Sort toggle sits left of the store picker it belongs to. */}
              {supermarketId != null ? (
                <Button
                  variant={sortMode === "learned" ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "shrink-0",
                    sortMode === "learned" && "text-[var(--color-accent)]",
                  )}
                  onClick={toggleSortMode}
                  aria-pressed={sortMode === "learned"}
                  aria-label="Gelernte Reihenfolge"
                  title={
                    sortMode === "learned"
                      ? "Gelernte Reihenfolge aktiv – tippen für Sortierung nach Kategorien"
                      : "In der gelernten Abhak-Reihenfolge dieses Supermarkts sortieren"
                  }
                >
                  <ArrowDownUp className="size-4" />
                  <span className="hidden lg:inline">Gelernt</span>
                </Button>
              ) : null}
              <SupermarketFilter
                value={supermarketId}
                supermarkets={supermarkets}
                neededCounts={neededCounts}
                onChange={persistSupermarket}
              />
            </div>
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center text-sm text-[var(--color-muted-fg)]">
          Noch keine Artikel auf der Liste. Füge Mahlzeiten aus dem Plan hinzu
          oder einen Artikel manuell.
        </div>
      ) : (
        <>
          <TabsContent value="open" className="flex flex-col gap-6">
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
                {learnedWanted && !grouped.learnedOrderApplied ? (
                  <p className="text-sm text-[var(--color-muted-fg)]">
                    Für diesen Supermarkt gibt es noch keine gelernte
                    Reihenfolge. Hake beim Einkaufen mit gewähltem Supermarkt
                    ab, dann lernt Nomly mit. Bis dahin wird nach Kategorien
                    sortiert.
                  </p>
                ) : null}
                {grouped.openGroups.map((group) => (
                  <section key={group.key} className="flex flex-col gap-2">
                    {group.label != null ? (
                      <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
                        {group.label}
                      </h2>
                    ) : null}
                    <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)]">
                      {group.items.map((i) => renderRow(i))}
                    </ul>
                  </section>
                ))}
              </>
            )}
          </TabsContent>

          <TabsContent value="checked" className="flex flex-col gap-6">
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
              <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] opacity-70">
                {grouped.checkedItems.map((i) => renderRow(i))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="unavailable" className="flex flex-col gap-6">
            {grouped.skippedHere.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
                  Heute nicht da
                </h2>
                <p className="text-sm text-[var(--color-muted-fg)]">
                  Gab es hier heute nicht – bleibt auf der Liste für andere
                  Supermärkte und taucht hier morgen wieder auf.
                </p>
                <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)]">
                  {grouped.skippedHere.map((item) =>
                    renderRow(
                      item,
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        disabled={disabledOffline || supermarketId == null}
                        onClick={() =>
                          supermarketId != null
                            ? void onSetSkipped(item, supermarketId, false)
                            : undefined
                        }
                      >
                        <RotateCcw className="size-4" />
                        <span className="hidden sm:inline">Wieder einblenden</span>
                        <span className="sm:hidden">Einblenden</span>
                      </Button>,
                    ),
                  )}
                </ul>
              </section>
            ) : null}
            {grouped.unavailableHere.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
                  Dauerhaft nicht verfügbar
                </h2>
                <p className="text-sm text-[var(--color-muted-fg)]">
                  Diese Artikel hast du hier als nicht verfügbar markiert – kauf
                  sie woanders. Hebe die Markierung auf, um sie wieder
                  einzublenden.
                </p>
                <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)]">
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
                        <RotateCcw className="size-4" />
                        <span className="hidden sm:inline">Hier verfügbar machen</span>
                        <span className="sm:hidden">Verfügbar</span>
                      </Button>,
                    ),
                  )}
                </ul>
              </section>
            ) : null}
          </TabsContent>
        </>
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
    </Tabs>
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

