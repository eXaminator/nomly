"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  GripVertical,
  ListPlus,
  Loader2,
  X,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectSearch } from "@/components/ui/select-search";
import { cn } from "@/lib/cn";

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
  const [unavailableArticles, setUnavailableArticles] = React.useState<
    Array<{ id: number; name: string }>
  >([]);
  const [loadingDetail, setLoadingDetail] = React.useState(item != null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  // Full category list, fetched once on mount — drives the "remaining" counter
  // on the add-all button and is reused by addAllRemaining (no second fetch).
  const [allCategories, setAllCategories] = React.useState<
    Array<{ id: number; name: string }>
  >([]);

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
          unavailableArticles: Array<{ id: number; name: string }>;
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
        setUnavailableArticles(detail.unavailableArticles ?? []);
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

  // Fetch the full category list once on mount (both create and edit) so the
  // add-all button can show how many categories are still missing.
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/categories?q=")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as {
          items: Array<{ id: number; name: string }>;
        };
      })
      .then((body) => {
        if (!cancelled) setAllCategories(body.items);
      })
      .catch(() => {
        // Non-fatal: the counter just won't show; addAllRemaining falls back
        // to fetching on click.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const trimmed = name.trim();
    onPayloadChange(
      {
        name: trimmed,
        orderedCategoryIds: orderedCategories.map((c) => c.categoryId),
        unavailableIngredientIds: unavailableArticles.map((a) => a.id),
      },
      trimmed.length > 0,
    );
  }, [name, orderedCategories, unavailableArticles, onPayloadChange]);

  const remainingCategories = React.useMemo(() => {
    const taken = new Set(orderedCategories.map((c) => c.categoryId));
    return allCategories.filter((c) => !taken.has(c.id));
  }, [allCategories, orderedCategories]);

  function removeAt(index: number) {
    setOrderedCategories((prev) => prev.filter((_, i) => i !== index));
  }

  function moveByOffset(index: number, offset: -1 | 1) {
    setOrderedCategories((prev) => {
      const j = index + offset;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  function moveToEdge(index: number, edge: "top" | "bottom") {
    setOrderedCategories((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = [...prev];
      const [row] = next.splice(index, 1);
      if (edge === "top") next.unshift(row);
      else next.push(row);
      return next;
    });
  }

  const sensors = useSensors(
    // Small activation distance so a row-level click that wasn't intended as a
    // drag (e.g. tap on the trash icon) doesn't accidentally trigger one.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOrderedCategories((prev) => {
      const from = prev.findIndex((c) => c.categoryId === active.id);
      const to = prev.findIndex((c) => c.categoryId === over.id);
      if (from === -1 || to === -1) return prev;
      return arrayMove(prev, from, to);
    });
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

  const [addingAll, setAddingAll] = React.useState(false);
  const [addAllError, setAddAllError] = React.useState<string | null>(null);

  async function addAllRemaining() {
    setAddingAll(true);
    setAddAllError(null);
    try {
      // Prefer the list fetched on mount; fall back to a fresh fetch if that
      // request hadn't landed (or failed) yet.
      let categories = allCategories;
      if (categories.length === 0) {
        const res = await fetch("/api/v1/categories?q=");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as {
          items: Array<{ id: number; name: string }>;
        };
        categories = body.items;
        setAllCategories(body.items);
      }
      setOrderedCategories((prev) => {
        const taken = new Set(prev.map((c) => c.categoryId));
        const additions = categories
          .filter((i) => !taken.has(i.id))
          .map((i) => ({ categoryId: i.id, categoryName: i.name }));
        return [...prev, ...additions];
      });
    } catch (e) {
      setAddAllError(
        e instanceof Error ? e.message : "Konnte Kategorien nicht laden.",
      );
    } finally {
      setAddingAll(false);
    }
  }

  const searchArticles = React.useCallback(
    async (q: string) => {
      const res = await fetch(
        `/api/v1/ingredients/manage?q=${encodeURIComponent(q)}`,
      );
      if (!res.ok) return [];
      const body = (await res.json()) as {
        items: Array<{ id: number; name: string }>;
      };
      const taken = new Set(unavailableArticles.map((a) => a.id));
      return body.items
        .filter((a) => !taken.has(a.id))
        .map((a) => ({ id: a.id, name: a.name }));
    },
    [unavailableArticles],
  );

  function addUnavailableArticle(picked: { id: number; name: string } | null) {
    if (!picked) return;
    setUnavailableArticles((prev) =>
      prev.some((a) => a.id === picked.id)
        ? prev
        : [...prev, { id: picked.id, name: picked.name }],
    );
  }

  function removeUnavailableArticle(id: number) {
    setUnavailableArticles((prev) => prev.filter((a) => a.id !== id));
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={orderedCategories.map((c) => c.categoryId)}
              strategy={verticalListSortingStrategy}
            >
              <ol className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
                {orderedCategories.map((c, idx) => (
                  <SortableCategoryRow
                    key={c.categoryId}
                    id={c.categoryId}
                    index={idx}
                    total={orderedCategories.length}
                    name={c.categoryName}
                    onMoveToTop={() => moveToEdge(idx, "top")}
                    onMoveUp={() => moveByOffset(idx, -1)}
                    onMoveDown={() => moveByOffset(idx, 1)}
                    onMoveToBottom={() => moveToEdge(idx, "bottom")}
                    onRemove={() => removeAt(idx)}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
        {!loadingDetail && (
          <div className="flex flex-col gap-2">
            <SelectSearch
              value={null}
              onChange={handlePickCategory}
              search={searchCategories}
              placeholder="Kategorie hinzufügen…"
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addAllRemaining}
                disabled={addingAll || remainingCategories.length === 0}
              >
                {addingAll ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ListPlus className="size-4" />
                )}
                Alle verbleibenden Kategorien hinzufügen
                {remainingCategories.length > 0
                  ? ` (${remainingCategories.length})`
                  : ""}
              </Button>
              {addAllError ? (
                <span className="text-xs text-[var(--color-danger)]">
                  {addAllError}
                </span>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {!loadingDetail && (
        <div className="flex flex-col gap-2">
          <Label>Nicht verfügbare Artikel</Label>
          <p className="text-xs text-[var(--color-muted-fg)]">
            Artikel, die dieser Supermarkt nicht führt. Auf der Einkaufsliste
            werden sie in diesem Markt ausgegraut.
          </p>
          {unavailableArticles.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {unavailableArticles.map((a) => (
                <li key={a.id}>
                  <span className="inline-flex items-center gap-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)] py-1 pl-2.5 pr-1 text-sm">
                    {a.name}
                    <button
                      type="button"
                      onClick={() => removeUnavailableArticle(a.id)}
                      aria-label={`${a.name} entfernen`}
                      className="inline-flex size-5 items-center justify-center rounded-md text-[var(--color-muted-fg)] hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)]"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <SelectSearch
            value={null}
            onChange={addUnavailableArticle}
            search={searchArticles}
            placeholder="Artikel hinzufügen…"
          />
        </div>
      )}
    </div>
  );
}

function SortableCategoryRow({
  id,
  index,
  total,
  name,
  onMoveToTop,
  onMoveUp,
  onMoveDown,
  onMoveToBottom,
  onRemove,
}: {
  id: number;
  index: number;
  total: number;
  name: string;
  onMoveToTop: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveToBottom: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const atTop = index === 0;
  const atBottom = index === total - 1;
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1 bg-[var(--color-bg)] px-3 py-2",
        isDragging && "relative z-10 shadow-lg",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`${name} per Drag-and-Drop verschieben`}
        className="-ml-1 inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-md text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <span className="w-6 text-xs tabular-nums text-[var(--color-muted-fg)]">
        {index + 1}.
      </span>
      <span className="flex-1 truncate text-sm">{name}</span>
      <Button
        variant="ghost"
        size="icon"
        onClick={onMoveToTop}
        disabled={atTop}
        aria-label={`${name} an den Anfang verschieben`}
        title="An den Anfang"
      >
        <ChevronsUp className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onMoveUp}
        disabled={atTop}
        aria-label={`${name} eine Position nach oben verschieben`}
        title="Nach oben"
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onMoveDown}
        disabled={atBottom}
        aria-label={`${name} eine Position nach unten verschieben`}
        title="Nach unten"
      >
        <ArrowDown className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onMoveToBottom}
        disabled={atBottom}
        aria-label={`${name} an das Ende verschieben`}
        title="Ans Ende"
      >
        <ChevronsDown className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label={`${name} entfernen`}
        title="Entfernen"
      >
        <X className="size-4" />
      </Button>
    </li>
  );
}
