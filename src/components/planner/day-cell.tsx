"use client";

import * as React from "react";
import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import {
  formatDayMonthDe,
  formatWeekdayShortDe,
} from "@/lib/meal-plans/dates";
import type { MealPlanView } from "@/lib/meal-plans/types";
import type { CalendarEvent } from "@/lib/ical/events";
import { MealCard } from "./meal-card";
import { EventList } from "./event-list";
import { cn } from "@/lib/cn";

type Props = {
  date: string;
  isToday: boolean;
  meals: MealPlanView[];
  events: CalendarEvent[];
  onEditMeal: (meal: MealPlanView) => void;
  onReorderUp: (mealId: number) => void;
  onReorderDown: (mealId: number) => void;
  onDeleteMeal: (mealId: number) => void;
  onAdjustPortions: (mealId: number, delta: number) => void;
  onToggleLeftover: (mealId: number, next: boolean) => void;
  onDuplicateLeftover: (mealId: number) => void;
  onAddMeal: (date: string) => void;
  onPreviewRecipe: (recipeId: number, mealPlanId: number) => void;
  /** Hover state for the in-flight drag (see PlannerView). When set, this
   *  cell shows a phantom placeholder above or below the named meal. */
  dropTarget: { mealId: number; side: "above" | "below" } | null;
  /** Size of the source element so the placeholder reads as "your card
   *  goes here". */
  dragSourceSize: { width: number; height: number } | null;
  draggable: boolean;
};

export function DayCell({
  date,
  isToday,
  meals,
  events,
  onEditMeal,
  onReorderUp,
  onReorderDown,
  onDeleteMeal,
  onAdjustPortions,
  onToggleLeftover,
  onDuplicateLeftover,
  onAddMeal,
  onPreviewRecipe,
  dropTarget,
  dragSourceSize,
  draggable,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day:${date}`,
    data: { type: "day", date },
  });

  return (
    <div
      className={cn(
        "flex flex-col rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-3",
        // Today's marker: a thick accent bar on the LEFT edge. Visually
        // distinct from the drop-zone ring (which highlights the meals
        // sub-column) so it doesn't get mistaken for one.
        isToday && "border-l-4 border-l-[var(--color-accent)] shadow-sm",
      )}
    >
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-xs font-medium uppercase tracking-wider",
              isToday ? "text-[var(--color-accent)]" : "text-[var(--color-muted-fg)]",
            )}
          >
            {formatWeekdayShortDe(date)}
          </span>
          <span className="text-sm text-[var(--color-fg)]">
            {formatDayMonthDe(date)}
          </span>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-2 md:grid-cols-[1fr_1px_2fr]">
        <EventList events={events} />

        {/* Light rule centred in the column gap (desktop only — the columns
            stack on mobile, where it collapses to nothing). */}
        <div className="hidden bg-[var(--color-border)] md:block" aria-hidden />

        {/* Meals column (DnD target). No padding on either breakpoint: meal
            rows then sit flush to the column edge, so they're the same
            distance from the divider as the events and their first card lines
            up with the first event's top. */}
        <div
          ref={setNodeRef}
          className={cn(
            // `relative` so absolutely-positioned dragged cards (see
            // MealCard's drag style) resolve their width:100% against this
            // column instead of the viewport.
            "relative flex min-h-[80px] flex-col gap-2 rounded-md transition-colors",
            isOver
              ? "bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)] ring-2 ring-[var(--color-accent)]"
              : "bg-transparent",
          )}
        >
          {meals.length === 0 ? (
            <button
              type="button"
              onClick={() => onAddMeal(date)}
              className="flex h-16 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--color-border)] text-xs text-[var(--color-muted-fg)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              <Plus className="size-3.5" />
              Mahlzeit hinzufügen
            </button>
          ) : (
            <>
              {meals.map((meal, idx) => {
                const isLast = idx === meals.length - 1;
                const showAbove =
                  dropTarget?.mealId === meal.id && dropTarget.side === "above";
                // "below" on the last meal is rendered INSIDE the day-end
                // zone (see below), not as a separate sibling, so we don't
                // shift the layout out from under the cursor.
                const showBelow =
                  !isLast &&
                  dropTarget?.mealId === meal.id &&
                  dropTarget.side === "below";
                return (
                  <React.Fragment key={meal.id}>
                    {showAbove ? (
                      <DropPlaceholder size={dragSourceSize} />
                    ) : null}
                    <MealCard
                      meal={meal}
                      onEdit={onEditMeal}
                      onReorderUp={onReorderUp}
                      onReorderDown={onReorderDown}
                      onDelete={onDeleteMeal}
                      onAdjustPortions={onAdjustPortions}
                      onToggleLeftover={onToggleLeftover}
                      onDuplicateLeftover={onDuplicateLeftover}
                      onPreviewRecipe={onPreviewRecipe}
                      draggable={draggable}
                    />
                    {showBelow ? (
                      <DropPlaceholder size={dragSourceSize} />
                    ) : null}
                  </React.Fragment>
                );
              })}
              <DayEndDropZone
                date={date}
                lastMealId={meals[meals.length - 1].id}
                onAddMeal={onAddMeal}
                isDropTarget={
                  dropTarget?.mealId === meals[meals.length - 1].id &&
                  dropTarget.side === "below"
                }
                dragSourceSize={dragSourceSize}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The "+" affordance below the last meal of a day. Wraps the button in a
 * dedicated droppable so dragging onto it counts as "below the last meal"
 * — keeps the bottom edge of the calendar list droppable instead of leaving
 * a dead zone the user has to aim past.
 */
function DayEndDropZone({
  date,
  lastMealId,
  onAddMeal,
  isDropTarget,
  dragSourceSize,
}: {
  date: string;
  lastMealId: number;
  onAddMeal: (date: string) => void;
  isDropTarget: boolean;
  dragSourceSize: { width: number; height: number } | null;
}) {
  const { setNodeRef } = useDroppable({
    id: `day-end:${date}`,
    data: { type: "day-end", date, lastMealId },
  });
  // The wrapper extends ITS HIT AREA upward into the parent's `gap-2`
  // between the last meal and this zone (`-mt-2 pt-2`). Without it, hovering
  // that 8px sliver resolves to the day-cell ("day") droppable, which
  // handleDragMove clears — so the placeholder flickers in and out as the
  // cursor crosses the gap. Visual layout stays the same: the negative
  // margin cancels the gap, the padding restores the breathing room.
  return (
    <div ref={setNodeRef} className="-mt-2 pt-2">
      {isDropTarget ? (
        <DropPlaceholder size={dragSourceSize} />
      ) : (
        <button
          type="button"
          onClick={() => onAddMeal(date)}
          aria-label="Mahlzeit hinzufügen"
          className="flex h-7 w-full items-center justify-center gap-1 rounded-md text-xs text-[var(--color-muted-fg)] opacity-0 transition-opacity hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)] focus-visible:opacity-100 group-hover:opacity-100 md:opacity-60"
        >
          <Plus className="size-3" />
        </button>
      )}
    </div>
  );
}

/**
 * Phantom card that occupies the slot the dragged item would land in.
 * Sized to the source's measured dimensions so the visual reads as
 * "your card goes right here".
 */
function DropPlaceholder({
  size,
}: {
  size: { width: number; height: number } | null;
}) {
  return (
    <div
      aria-hidden
      style={{ height: size ? `${size.height}px` : "3rem" }}
      className="rounded-[var(--radius)] border-2 border-dashed border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_85%)]"
    />
  );
}
