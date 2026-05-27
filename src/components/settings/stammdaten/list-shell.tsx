"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

import { DeleteDialog } from "./delete-dialog";
import { DrawerShell } from "./drawer-shell";
import { MergeDialog } from "./merge-dialog";
import { MergeProposalsDialog } from "./merge-proposals-dialog";
import {
  ENTITY_LABELS,
  type EntityKind,
} from "./types";

export type ColumnDef<TItem> = {
  key: string;
  header: string;
  cell: (item: TItem) => React.ReactNode;
  className?: string;
  /** When provided, the column header becomes a clickable sort toggle. The
   *  returned value drives the ordering — strings sort with locale "de",
   *  numbers/booleans numerically, and `null` always lands at the end
   *  regardless of direction (so empty cells don't crowd the top in desc). */
  sortValue?: (item: TItem) => string | number | boolean | null;
};

export type SortState = { key: string; dir: "asc" | "desc" } | null;

function compareSortValues(
  a: string | number | boolean | null,
  b: string | number | boolean | null,
  dir: "asc" | "desc",
): number {
  // Nulls always sink to the bottom — flipping direction doesn't lift them
  // back to the top. Otherwise descending an "exclude only" column would
  // pile the empty rows above the relevant ones.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  let cmp: number;
  if (typeof a === "string" && typeof b === "string") {
    cmp = a.localeCompare(b, "de", { sensitivity: "base" });
  } else if (typeof a === "boolean" && typeof b === "boolean") {
    cmp = a === b ? 0 : a ? 1 : -1;
  } else {
    cmp = (a as number) - (b as number);
  }
  return dir === "asc" ? cmp : -cmp;
}

export type EditFormProps<TItem> = {
  item: TItem | null;
  onPayloadChange: (payload: unknown, valid: boolean) => void;
};

export type ListShellProps<TItem> = {
  entityKind: EntityKind;
  initialItems: TItem[];
  columns: ColumnDef<TItem>[];
  idOf: (item: TItem) => number;
  nameOf: (item: TItem) => string;
  /** Filter function applied after the freetext search; e.g. for chip filters. */
  applyFilters?: (item: TItem) => boolean;
  filterControls?: React.ReactNode;
  /** Render the form fields inside the drawer. Calls onPayloadChange whenever
   *  the form state changes; the shell handles submit via the standard endpoint. */
  EditForm: React.ComponentType<EditFormProps<TItem>>;
  /** Hard-delete allowed when there are no hard-blocker FKs (e.g. units, tags). */
  hardDeleteAllowed: boolean;
  hardDeleteDisabledReason?: string;
  /** Optional inline warning for merge dialog (e.g. tag merge: names lost). */
  mergeWarning?: React.ReactNode;
  /** Custom in-memory filter for the freetext search (defaults to canonical name). */
  searchMatches?: (item: TItem, query: string) => boolean;
  /** When true, an "Ähnliche zusammenführen" button opens the merge-proposals
   *  dialog. Server side needs a `/api/v1/<entity>/merge-proposals` endpoint. */
  enableMergeProposals?: boolean;
  /** Optional entity-specific bulk-edit slot rendered in the sticky selection
   *  bar. Receives the current selection and a callback that clears the
   *  selection and refreshes the list after the bulk patch lands. */
  renderBulkActions?: (args: {
    selectedIds: number[];
    onApplied: () => void;
  }) => React.ReactNode;
  /** Default sort applied on mount. Keeps the list ordered by this column even
   *  as rows are added client-side (a new row sorts into place instead of
   *  landing at the bottom). The column's `sortValue` must be set. */
  initialSort?: SortState;
};

export function ListShell<TItem>({
  entityKind,
  initialItems,
  columns,
  idOf,
  nameOf,
  applyFilters,
  filterControls,
  EditForm,
  hardDeleteAllowed,
  hardDeleteDisabledReason,
  mergeWarning,
  searchMatches,
  enableMergeProposals,
  renderBulkActions,
  initialSort,
}: ListShellProps<TItem>) {
  const router = useRouter();
  const labels = ENTITY_LABELS[entityKind];
  const plural = pluralFor(entityKind);

  const [items, setItems] = React.useState<TItem[]>(initialItems);
  // Re-sync when the server sends fresh data — e.g. after a bulk edit calls
  // router.refresh(). Single edits/merge/delete patch `items` locally and
  // don't change `initialItems`, so this won't clobber their optimistic state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setItems(initialItems), [initialItems]);
  // `inputValue` reflects the input field; `query` is the debounced value
  // actually used for filtering. Typing on a 400-row list is noticeably
  // smoother when the filter run waits for the user to pause briefly.
  const [inputValue, setInputValue] = React.useState("");
  const [query, setQuery] = React.useState("");
  React.useEffect(() => {
    if (inputValue === query) return;
    const handle = window.setTimeout(() => setQuery(inputValue), 180);
    return () => window.clearTimeout(handle);
  }, [inputValue, query]);
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());

  // Drawer state
  const [drawer, setDrawer] = React.useState<
    { mode: "edit"; item: TItem } | { mode: "create" } | null
  >(null);
  const [drawerPayload, setDrawerPayload] = React.useState<unknown>(null);
  const [drawerValid, setDrawerValid] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [drawerError, setDrawerError] = React.useState<string | null>(null);

  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState<TItem[] | null>(null);
  const [proposalsOpen, setProposalsOpen] = React.useState(false);

  // Memoize so each form's onPayloadChange-deps don't churn every parent
  // render — otherwise the form's "publish payload" effect re-fires in a
  // loop because the callback reference changes on every render.
  const handlePayloadChange = React.useCallback(
    (payload: unknown, valid: boolean) => {
      setDrawerPayload(payload);
      setDrawerValid(valid);
    },
    [],
  );

  const [sort, setSort] = React.useState<SortState>(initialSort ?? null);

  const filtered = React.useMemo(() => {
    // Split on "|" so the user can OR-connect multiple terms
    // ("tomato|onion" → matches either). Empty terms are dropped so
    // trailing/leading pipes are forgiving.
    const terms = query
      .toLowerCase()
      .split("|")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const matched = items.filter((item) => {
      if (terms.length > 0) {
        const hit = searchMatches
          ? terms.some((t) => searchMatches(item, t))
          : terms.some((t) => nameOf(item).toLowerCase().includes(t));
        if (!hit) return false;
      }
      if (applyFilters && !applyFilters(item)) return false;
      return true;
    });
    if (!sort) return matched;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return matched;
    const valueOf = column.sortValue;
    // Stable sort: tag each row with its original index so equal-keyed
    // rows preserve the underlying service-side order.
    const tagged = matched.map((item, idx) => ({ item, idx }));
    tagged.sort((a, b) => {
      const cmp = compareSortValues(valueOf(a.item), valueOf(b.item), sort.dir);
      return cmp !== 0 ? cmp : a.idx - b.idx;
    });
    return tagged.map((t) => t.item);
  }, [items, query, applyFilters, nameOf, searchMatches, sort, columns]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      // Third click clears the sort, restoring the service-side order.
      return null;
    });
  }

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((i) => selectedIds.has(idOf(i)));
  const someFilteredSelected =
    filtered.some((i) => selectedIds.has(idOf(i))) && !allFilteredSelected;

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const i of filtered) next.delete(idOf(i));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const i of filtered) next.add(idOf(i));
        return next;
      });
    }
  }

  const toggleRow = React.useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedItems = filtered.filter((i) => selectedIds.has(idOf(i)));

  function openCreate() {
    setDrawer({ mode: "create" });
    setDrawerPayload(null);
    setDrawerValid(false);
    setDrawerError(null);
  }
  const openEdit = React.useCallback((item: TItem) => {
    setDrawer({ mode: "edit", item });
    setDrawerPayload(null);
    setDrawerValid(false);
    setDrawerError(null);
  }, []);
  function closeDrawer() {
    setDrawer(null);
    setDrawerPayload(null);
    setDrawerError(null);
  }

  async function saveDrawer() {
    if (!drawer || drawerPayload == null) return;
    setSaving(true);
    setDrawerError(null);
    try {
      const url =
        drawer.mode === "create"
          ? `/api/v1/${plural}/manage`
          : `/api/v1/${plural}/manage/${idOf(drawer.item)}`;
      const method = drawer.mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(drawerPayload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error ??
            `${drawer.mode === "create" ? "Anlegen" : "Speichern"} fehlgeschlagen (${res.status}).`,
        );
      }
      const saved = (await res.json()) as TItem;
      setItems((prev) => {
        if (drawer.mode === "create") return [...prev, saved];
        return prev.map((p) => (idOf(p) === idOf(drawer.item) ? saved : p));
      });
      closeDrawer();
    } catch (e) {
      setDrawerError(
        e instanceof Error ? e.message : "Unbekannter Fehler.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleMerge(
    winnerId: number,
    loserIds: number[],
    replaceIds: number[],
  ) {
    const res = await fetch(`/api/v1/${plural}/merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ winnerId, loserIds, replaceIds }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Merge fehlgeschlagen (${res.status}).`);
    }
    setSelectedIds(new Set());
    router.refresh();
    // Local optimistic update: drop losers from list.
    setItems((prev) => prev.filter((i) => !loserIds.includes(idOf(i))));
  }

  async function handleDelete(
    replaceWith: number | null,
    ids: number[],
  ) {
    for (const id of ids) {
      const url = replaceWith
        ? `/api/v1/${plural}/manage/${id}?replaceWith=${replaceWith}`
        : `/api/v1/${plural}/manage/${id}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Löschen fehlgeschlagen (${res.status}).`);
      }
    }
    setSelectedIds(new Set());
    setItems((prev) => prev.filter((i) => !ids.includes(idOf(i))));
    closeDrawer();
    router.refresh();
  }

  async function searchReplacement(
    q: string,
    excludeIds: number[],
  ): Promise<Array<{ id: number; name: string }>> {
    const res = await fetch(
      `/api/v1/${plural}/manage?q=${encodeURIComponent(q)}`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { items: Array<TItem> };
    return body.items
      .filter((i) => !excludeIds.includes(idOf(i)))
      .slice(0, 20)
      .map((i) => ({ id: idOf(i), name: nameOf(i) }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {labels.plural}
          <span className="ml-2 text-base font-normal text-[var(--color-muted-fg)]">
            {filtered.length === items.length
              ? `(${items.length})`
              : `(${filtered.length} / ${items.length})`}
          </span>
        </h1>
        <div className="flex items-center gap-2">
          {enableMergeProposals && (
            <Button
              variant="outline"
              onClick={() => setProposalsOpen(true)}
            >
              Ähnliche zusammenführen
            </Button>
          )}
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Neu
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-fg)]" />
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={`Suchen… (mehrere mit „|" trennen)`}
            className="pl-9"
          />
        </div>
        {filterControls && (
          <div className="flex flex-wrap items-center gap-2">{filterControls}</div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-fg)]">
          {query.trim().length > 0
            ? `Keine Treffer für "${query}".`
            : `Noch keine ${labels.plural} angelegt.`}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-fg)]">
              <tr>
                <th className="px-3 py-2 w-10">
                  <Checkbox
                    checked={
                      someFilteredSelected
                        ? "indeterminate"
                        : allFilteredSelected
                    }
                    onCheckedChange={() => toggleSelectAll()}
                    aria-label="Alle auswählen"
                  />
                </th>
                {columns.map((c) => {
                  const sortable = c.sortValue !== undefined;
                  const active = sortable && sort?.key === c.key;
                  const Icon = !sortable
                    ? null
                    : !active
                      ? ArrowUpDown
                      : sort?.dir === "asc"
                        ? ArrowUp
                        : ArrowDown;
                  const ariaSort: "ascending" | "descending" | "none" = active
                    ? sort?.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none";
                  return (
                    <th
                      key={c.key}
                      className={cn("px-3 py-2 font-medium", c.className)}
                      aria-sort={sortable ? ariaSort : undefined}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          className={cn(
                            "inline-flex items-center gap-1 uppercase tracking-wide",
                            active
                              ? "text-[var(--color-fg)]"
                              : "hover:text-[var(--color-fg)]",
                          )}
                        >
                          {c.header}
                          {Icon ? (
                            <Icon
                              className={cn(
                                "size-3",
                                active ? "opacity-100" : "opacity-40",
                              )}
                            />
                          ) : null}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <ListTableBody
              filtered={filtered}
              selectedIds={selectedIds}
              columns={columns}
              idOf={idOf}
              nameOf={nameOf}
              onOpenEdit={openEdit}
              onToggleRow={toggleRow}
            />
          </table>
        </div>
      )}

      <p className="text-xs text-[var(--color-muted-fg)]">
        {filtered.length} {filtered.length === 1 ? labels.singular : labels.plural}
        {filtered.length !== items.length && ` (von ${items.length})`}
      </p>

      {selectedItems.length > 0 && (
        <div className="sticky bottom-4 mx-auto flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 shadow-lg">
          <span className="text-sm font-medium">
            {selectedItems.length} ausgewählt
          </span>
          {renderBulkActions?.({
            selectedIds: selectedItems.map((i) => idOf(i)),
            onApplied: () => {
              setSelectedIds(new Set());
              router.refresh();
            },
          })}
          <Button
            variant="outline"
            size="sm"
            disabled={selectedItems.length < 2}
            onClick={() => setMergeOpen(true)}
          >
            Zusammenführen
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setDeleteOpen(selectedItems)}
          >
            Löschen
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds(new Set())}
          >
            Auswahl aufheben
          </Button>
        </div>
      )}

      {drawer && (
        <DrawerShell
          open={true}
          onClose={closeDrawer}
          title={
            drawer.mode === "create" ? `Neue ${labels.singular}` : nameOf(drawer.item)
          }
          mode={drawer.mode}
          onSave={saveDrawer}
          saving={saving}
          saveDisabled={!drawerValid}
          error={drawerError}
          onDelete={
            drawer.mode === "edit"
              ? () => setDeleteOpen([drawer.item])
              : undefined
          }
        >
          <EditForm
            item={drawer.mode === "edit" ? drawer.item : null}
            onPayloadChange={handlePayloadChange}
          />
        </DrawerShell>
      )}

      {mergeOpen && selectedItems.length >= 2 && (
        <MergeDialog
          open={mergeOpen}
          onClose={() => setMergeOpen(false)}
          entityKind={entityKind}
          items={selectedItems}
          idOf={idOf}
          nameOf={nameOf}
          warning={mergeWarning}
          onSubmit={handleMerge}
        />
      )}

      {deleteOpen && deleteOpen.length > 0 && (
        <DeleteDialog
          open={true}
          onClose={() => setDeleteOpen(null)}
          entityKind={entityKind}
          items={deleteOpen}
          idOf={idOf}
          nameOf={nameOf}
          searchReplacement={searchReplacement}
          hardDeleteAllowed={hardDeleteAllowed}
          hardDeleteDisabledReason={hardDeleteDisabledReason}
          onSubmit={handleDelete}
        />
      )}

      {enableMergeProposals && proposalsOpen && (
        <MergeProposalsDialog
          open={proposalsOpen}
          onClose={() => setProposalsOpen(false)}
          entityKind={entityKind}
          onMerged={() => {
            // Trigger a full refresh — the proposals dialog may have merged
            // many rows at once, and re-fetching is simpler than patching
            // them out one by one.
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function pluralFor(kind: EntityKind): string {
  switch (kind) {
    case "ingredient":
      return "ingredients";
    case "unit":
      return "units";
    case "category":
      return "categories";
    case "tag":
      return "tags";
    case "supermarket":
      return "supermarkets";
  }
}

/**
 * Memoized table body — re-renders only when filtered rows, selection, or
 * column defs change. Opening/closing the drawer or typing in the form
 * doesn't invalidate it, so 300+ rows aren't re-walked per keystroke.
 */
type ListTableBodyProps<TItem> = {
  filtered: TItem[];
  selectedIds: Set<number>;
  columns: ColumnDef<TItem>[];
  idOf: (item: TItem) => number;
  nameOf: (item: TItem) => string;
  onOpenEdit: (item: TItem) => void;
  onToggleRow: (id: number) => void;
};

function ListTableBodyImpl<TItem>({
  filtered,
  selectedIds,
  columns,
  idOf,
  nameOf,
  onOpenEdit,
  onToggleRow,
}: ListTableBodyProps<TItem>) {
  return (
    <tbody className="divide-y divide-[var(--color-border)]">
      {filtered.map((item) => {
        const id = idOf(item);
        return (
          <ListTableRow
            key={id}
            item={item}
            id={id}
            selected={selectedIds.has(id)}
            columns={columns}
            nameOf={nameOf}
            onOpenEdit={onOpenEdit}
            onToggleRow={onToggleRow}
          />
        );
      })}
    </tbody>
  );
}

const ListTableBody = React.memo(ListTableBodyImpl) as typeof ListTableBodyImpl;

/**
 * Single-row component. Memo'd on its own props so that toggling one
 * checkbox re-renders just that row and the previously-checked one (their
 * `selected` flips), not all ~400 ingredient rows. The stable callbacks
 * from `useCallback` in ListShell make this memoization effective.
 */
type ListTableRowProps<TItem> = {
  item: TItem;
  id: number;
  selected: boolean;
  columns: ColumnDef<TItem>[];
  nameOf: (item: TItem) => string;
  onOpenEdit: (item: TItem) => void;
  onToggleRow: (id: number) => void;
};

function ListTableRowImpl<TItem>({
  item,
  id,
  selected,
  columns,
  nameOf,
  onOpenEdit,
  onToggleRow,
}: ListTableRowProps<TItem>) {
  return (
    <tr
      className={cn(
        "hover:bg-[var(--color-muted)] cursor-pointer",
        selected &&
          "bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)]",
      )}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("[data-row-checkbox]")) return;
        onOpenEdit(item);
      }}
    >
      <td className="px-3 py-2 w-10" data-row-checkbox>
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleRow(id)}
          aria-label={`${nameOf(item)} auswählen`}
        />
      </td>
      {columns.map((c) => (
        <td key={c.key} className={cn("px-3 py-2", c.className)}>
          {c.cell(item)}
        </td>
      ))}
    </tr>
  );
}

const ListTableRow = React.memo(ListTableRowImpl) as typeof ListTableRowImpl;
