"use client";

import * as React from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronUp,
  CopyPlus,
  Minus,
  Pencil,
  Plus,
  Soup,
  Trash2,
} from "lucide-react";
import type { MealPlanView } from "@/lib/meal-plans/types";
import { DietBadge } from "@/components/recipes/diet-badge";
import { cn } from "@/lib/cn";

type Props = {
  meal: MealPlanView;
  onEdit: (meal: MealPlanView) => void;
  onReorderUp: (mealId: number) => void;
  onReorderDown: (mealId: number) => void;
  onDelete: (mealId: number) => void;
  /** Adjust this meal's portions by `delta` (clamped to ≥ 1 by the parent). */
  onAdjustPortions: (mealId: number, delta: number) => void;
  /** Toggle the leftover flag on this meal. */
  onToggleLeftover: (mealId: number, next: boolean) => void;
  /** Duplicate this meal onto the next day as a leftover. */
  onDuplicateLeftover: (mealId: number) => void;
  onPreviewRecipe: (recipeId: number, mealPlanId: number) => void;
  /** Disable DnD on mobile breakpoints — the parent decides via media query. */
  draggable: boolean;
};

export function MealCard({
  meal,
  onEdit,
  onReorderUp,
  onReorderDown,
  onDelete,
  onAdjustPortions,
  onToggleLeftover,
  onDuplicateLeftover,
  onPreviewRecipe,
  draggable,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `meal:${meal.id}`,
    data: { type: "meal", mealId: meal.id, sourceDate: meal.date },
    disabled: !draggable,
  });

  // Each meal is also a drop target: drag-and-drop another meal onto it to
  // reorder within the day (or insert from another day / from the recipe
  // list). Disabled while this meal itself is being dragged so it can't
  // drop on itself.
  const { setNodeRef: setDropRef } = useDroppable({
    id: `meal:${meal.id}`,
    data: { type: "meal", mealId: meal.id, date: meal.date },
    disabled: isDragging,
  });

  const setNodeRef = React.useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  const [confirmDelete, setConfirmDelete] = React.useState(false);
  React.useEffect(() => {
    if (!confirmDelete) return;
    // Auto-cancel pending confirm if the user walks away — better than
    // leaving a hot trash button armed indefinitely.
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  // Track the pointer-down coords on the card body so we can distinguish a
  // click (which should open the preview) from a drag (which @dnd-kit may
  // still fire a synthetic click after). If the pointer moved further than
  // the sensor's activation distance, treat the click as the tail end of a
  // drag and swallow it.
  const downCoordsRef = React.useRef<{ x: number; y: number } | null>(null);
  const ACTIVATION_DISTANCE = 5;

  // True when the meal's portions differ from the recipe's own serving count
  // — drives the highlight on the stepper's number.
  const isCustomServings = meal.servings !== meal.recipe.baseServings;

  // Shared by the image + title links: record the pointer-down coords, then
  // on click distinguish a genuine click (open preview) from the synthetic
  // click that ends a drag (movement past the sensor threshold → swallow).
  const handlePreviewPointerDown = (e: React.PointerEvent) => {
    downCoordsRef.current = { x: e.clientX, y: e.clientY };
  };
  const handlePreviewClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    const down = downCoordsRef.current;
    if (
      down &&
      Math.hypot(e.clientX - down.x, e.clientY - down.y) > ACTIVATION_DISTANCE
    ) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onPreviewRecipe(meal.recipe.id, meal.id);
  };

  // Capture the source's viewport rect at pointer-down so the dragging style
  // can pin it explicitly via `position: fixed`. `position: absolute` (the
  // previous approach) relies on the browser's static-position fallback,
  // which doesn't compute reliably when siblings around the source have
  // shifted (e.g. the day-end zone's `-mt-2` for the last meal of a day).
  // Each new pointerdown overrides, so stale values aren't a concern.
  const [initialRect, setInitialRect] = React.useState<
    | { top: number; left: number; width: number; height: number }
    | null
  >(null);

  const pinnedRect = isDragging ? initialRect : null;
  const style: React.CSSProperties = pinnedRect
    ? {
        // Pin the source at its captured viewport position. `position: fixed`
        // is out of flex flow (so siblings close up) AND avoids the
        // static-position fallback entirely, so `DragOverlay` reads a stable
        // rect that matches where the user grabbed the card — regardless of
        // surrounding layout (last meal, mt-shift on day-end zone, etc.).
        position: "fixed",
        top: pinnedRect.top,
        left: pinnedRect.left,
        width: pinnedRect.width,
        opacity: 0,
        pointerEvents: "none",
        transform: CSS.Translate.toString(transform),
      }
    : isDragging
      ? {
          // Fallback when isDragging fires without a prior pointerdown
          // (keyboard sensor, etc.) — the source stays in the DOM but
          // visually invisible.
          opacity: 0,
          pointerEvents: "none",
          transform: CSS.Translate.toString(transform),
        }
      : {
          transform: CSS.Translate.toString(transform),
        };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex items-stretch gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-2 shadow-sm transition-colors hover:border-[var(--color-accent)]",
        // Whole card is the drag handle on desktop. Keep `select-none` so
        // text doesn't get selected mid-drag.
        draggable && "cursor-grab select-none active:cursor-grabbing",
        // Leftover days read as secondary: muted background, dashed border,
        // slightly faded. The "Reste" label + active toggle make it explicit.
        meal.isLeftover &&
          "border-dashed bg-[var(--color-muted)]/30 opacity-75 shadow-none",
      )}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      onPointerDown={(e) => {
        // Capture the source's rect BEFORE @dnd-kit applies the dragging
        // style. `e.currentTarget` is this outer card div, so its rect is
        // the source's pre-drag layout box. Then forward to dnd-kit's
        // own pointerdown handler (overridden by our explicit prop above).
        if (draggable) {
          const r = e.currentTarget.getBoundingClientRect();
          setInitialRect({
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
          });
          listeners?.onPointerDown?.(e);
        }
      }}
    >
      {/* Drop indicator lives in DayCell (a sized phantom placeholder
          above/below this card), not here — keeps the card itself stable. */}

      {/* Real <a>s so cmd/ctrl/shift-click and middle-click open the recipe
          in a new tab natively. A plain left-click is intercepted to open
          the in-page preview dialog (owned by PlannerView). The pointer
          coords let us tell a click apart from the synthetic click that
          fires at the end of a drag. The portion stepper below is NOT inside
          an anchor (nested buttons are invalid), so the image + title are
          their own links and the content column holds the stepper alongside. */}
      <a
        href={`/rezepte/${meal.recipe.id}?meal=${meal.id}`}
        aria-label={`„${meal.recipe.title}“ ansehen`}
        className="shrink-0 self-center focus-visible:outline-none"
        onPointerDown={handlePreviewPointerDown}
        onClick={handlePreviewClick}
      >
        {meal.recipe.photoPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/v1/${meal.recipe.photoPath}`}
            alt=""
            className="size-12 rounded object-cover"
          />
        ) : (
          <div className="size-12 rounded bg-[var(--color-muted)]" />
        )}
      </a>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <a
          href={`/rezepte/${meal.recipe.id}?meal=${meal.id}`}
          className="flex min-w-0 items-center gap-1.5 focus-visible:outline-none"
          onPointerDown={handlePreviewPointerDown}
          onClick={handlePreviewClick}
        >
          <DietBadge
            isVegan={meal.recipe.isVegan}
            isVegetarian={meal.recipe.isVegetarian}
            confidence={meal.recipe.dietConfidence}
            size="sm"
          />
          <span className="truncate text-sm font-medium text-[var(--color-fg)]">
            {meal.recipe.title}
          </span>
          {meal.isLeftover ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-muted)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
              <Soup className="size-3" />
              Reste
            </span>
          ) : null}
        </a>
        <div className="flex min-w-0 items-center gap-1 text-xs text-[var(--color-muted-fg)]">
          <button
            type="button"
            aria-label="Weniger Portionen"
            title="Weniger Portionen"
            disabled={meal.servings <= 1}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onAdjustPortions(meal.id, -1);
            }}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-40"
          >
            <Minus className="size-3" />
          </button>
          <span
            className={cn(
              "shrink-0 tabular-nums",
              // Highlight when the meal deviates from the recipe's own
              // serving count, so a customised portion stands out.
              isCustomServings
                ? "font-semibold text-[var(--color-accent)]"
                : undefined,
            )}
          >
            {meal.servings} Portionen
          </span>
          <button
            type="button"
            aria-label="Mehr Portionen"
            title="Mehr Portionen"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onAdjustPortions(meal.id, 1);
            }}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <Plus className="size-3" />
          </button>
          {meal.note ? <span className="truncate">· {meal.note}</span> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-start gap-0.5">
        {/* Leftover controls + edit + delete. */}
        <div className="flex flex-wrap justify-end gap-0.5">
          <button
            type="button"
            aria-label={meal.isLeftover ? "Reste-Markierung entfernen" : "Als Reste markieren"}
            title={meal.isLeftover ? "Reste-Markierung entfernen" : "Als Reste markieren"}
            aria-pressed={meal.isLeftover}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleLeftover(meal.id, !meal.isLeftover);
            }}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
              meal.isLeftover
                ? "bg-[var(--color-muted)] text-[var(--color-fg)]"
                : "text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]",
            )}
          >
            <Soup className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Als Reste auf nächsten Tag kopieren"
            title="Als Reste auf nächsten Tag kopieren"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDuplicateLeftover(meal.id);
            }}
            className="inline-flex size-7 items-center justify-center rounded-md text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <CopyPlus className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Bearbeiten"
            title="Bearbeiten"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onEdit(meal);
            }}
            className="inline-flex size-7 items-center justify-center rounded-md text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            aria-label={confirmDelete ? "Wirklich löschen?" : "Löschen"}
            title={confirmDelete ? "Wirklich löschen?" : "Löschen"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (confirmDelete) {
                setConfirmDelete(false);
                onDelete(meal.id);
              } else {
                setConfirmDelete(true);
              }
            }}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
              confirmDelete
                ? "bg-[var(--color-danger)] text-white animate-pulse"
                : "text-[var(--color-muted-fg)] hover:bg-[color-mix(in_srgb,var(--color-danger),transparent_88%)] hover:text-[var(--color-danger)]",
            )}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
        {/* Move buttons stay vertically stacked, on the far right. */}
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            aria-label="Nach oben"
            title="Nach oben"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onReorderUp(meal.id);
            }}
            className="inline-flex size-7 items-center justify-center rounded-md text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Nach unten"
            title="Nach unten"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onReorderDown(meal.id);
            }}
            className="inline-flex size-7 items-center justify-center rounded-md text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
