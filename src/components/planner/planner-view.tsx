"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  defaultDropAnimation,
  pointerWithin,
  useDndContext,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import { DietBadge } from "@/components/recipes/diet-badge";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { addDays, alignToStartWeekday } from "@/lib/meal-plans/dates";
import {
  defaultMealPortions,
  type MealPlanView,
  type RecipeUsageStats,
} from "@/lib/meal-plans/types";
import type { RecipeListItem } from "@/lib/recipes/types";
import type { PlannerSettings } from "@/lib/settings/planner";
import { DayCell } from "./day-cell";
import { RecipePanel } from "./recipe-panel";
import { MealEditor } from "./meal-editor";
import { AddMealModal } from "./add-meal-modal";
import { RecipePreviewDialog } from "./recipe-preview-dialog";
import {
  apiCreateMeal,
  apiDeleteMeal,
  apiDeleteMealWithShopping,
  apiMoveMeal,
  apiReorderDay,
  apiReorderMeal,
  apiUpdateMeal,
} from "./api";
import type { DragData, DropData } from "./types";

type Props = {
  today: string;
  settings: PlannerSettings;
  from: string;
  dates: string[];
  initialMealPlans: MealPlanView[];
  recipes: RecipeListItem[];
  /** Per-recipe usage stats keyed by recipeId. Recipes without a meal_plan
   *  row don't appear here — RecipePanel falls back to "noch nie geplant". */
  recipeUsage: Array<{ recipeId: number } & RecipeUsageStats>;
  allTags: string[];
};

export function PlannerView({
  today,
  settings,
  from,
  dates,
  initialMealPlans,
  recipes,
  recipeUsage,
  allTags,
}: Props) {
  const router = useRouter();
  // Local copy lets us run optimistic mutations against the server data.
  const [mealPlans, setMealPlans] = React.useState(initialMealPlans);
  // Sync the server snapshot back into local state whenever the SSR prop
  // changes (router.refresh after a mutation, or a navigation). The lint
  // rule is generally right, but this is the exact "external server data
  // changed → reset local cache" case it warns against, and the one-frame
  // lag behind router.refresh() is invisible to the user.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setMealPlans(initialMealPlans), [initialMealPlans]);
  const [editing, setEditing] = React.useState<MealPlanView | null>(null);
  const [addingForDate, setAddingForDate] = React.useState<string | null>(null);
  // Owned at PlannerView level so both calendar meal cards and the recipe
  // panel rows can open the same dialog.
  const [previewRecipeId, setPreviewRecipeId] = React.useState<number | null>(null);
  const [activeDrag, setActiveDrag] = React.useState<DragData | null>(null);
  // Default to the fly-back animation; flipped to `null` synchronously on a
  // valid drop so the overlay vanishes in place instead of animating home.
  const [dropAnimation, setDropAnimation] = React.useState<DropAnimation | null>(
    defaultDropAnimation,
  );
  // While dragging, which meal card is being hovered and on which side
  // (above / below). Computed from cursor-vs-target centroids in onDragMove.
  // `null` when the drag isn't over a meal card.
  const [dropTarget, setDropTarget] = React.useState<{
    mealId: number;
    side: "above" | "below";
  } | null>(null);
  // Source size captured at drag start so DayCell can render a phantom
  // placeholder shaped like the dragged item.
  const [dragSourceSize, setDragSourceSize] = React.useState<{
    width: number;
    height: number;
  } | null>(null);
  const [busy, setBusy] = React.useState(false);

  function maxSortOrderForDate(date: string): number {
    let max = -1;
    for (const m of mealPlans) {
      if (m.date === date && m.sortOrder > max) max = m.sortOrder;
    }
    return max;
  }

  function makeOptimisticMeal(
    recipe: RecipeListItem,
    date: string,
    servings: number,
    note: string | null,
  ): MealPlanView {
    return {
      // Negative IDs can never collide with real autoincrement rows from the
      // server, so the next refresh reconciliation is unambiguous.
      id: -Date.now(),
      date,
      servings,
      servingsOverride: servings,
      note,
      sortOrder: maxSortOrderForDate(date) + 1,
      hasShoppingImpact: false,
      recipe: {
        id: recipe.id,
        title: recipe.title,
        photoPath: recipe.photoPath,
        baseServings: recipe.servings,
        isVegan: recipe.isVegan,
        isVegetarian: recipe.isVegetarian,
      },
    };
  }

  const mealsByDate = React.useMemo(() => {
    const map = new Map<string, MealPlanView[]>();
    for (const d of dates) map.set(d, []);
    for (const m of mealPlans) {
      const list = map.get(m.date);
      if (list) list.push(m);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [mealPlans, dates]);

  function navigateTo(newFrom: string) {
    router.push(`/plan?from=${newFrom}`);
  }

  function goPrevious() {
    navigateTo(addDays(from, -settings.daysVisible));
  }
  function goNext() {
    navigateTo(addDays(from, settings.daysVisible));
  }
  function goToday() {
    navigateTo(alignToStartWeekday(today, settings.startWeekday));
  }

  async function handleDaysVisibleChange(value: number) {
    await fetch("/api/v1/settings/planner", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ daysVisible: value }),
    });
    router.refresh();
  }

  async function withBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (busy) return;
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      console.error(e);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(input: {
    recipeId: number;
    date: string;
    servings: number;
    note: string;
  }) {
    const recipe = recipes.find((r) => r.id === input.recipeId);
    if (recipe) {
      const note = input.note.length > 0 ? input.note : null;
      const optimistic = makeOptimisticMeal(recipe, input.date, input.servings, note);
      setMealPlans((prev) => [...prev, optimistic]);
    }
    await withBusy(async () => {
      await apiCreateMeal({
        recipeId: input.recipeId,
        date: input.date,
        servingsOverride: input.servings,
        note: input.note.length > 0 ? input.note : null,
      });
      router.refresh();
    });
  }

  async function handleSaveEdit(
    id: number,
    patch: {
      servingsOverride: number | null;
      note: string | null;
      date?: string;
    },
  ) {
    // Optimistic edit so the side panel closes against the new values.
    setMealPlans((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        const servings =
          patch.servingsOverride ?? m.recipe.baseServings;
        return {
          ...m,
          servings,
          servingsOverride: patch.servingsOverride,
          note: patch.note,
          date: patch.date ?? m.date,
        };
      }),
    );
    await withBusy(async () => {
      await apiUpdateMeal(id, {
        servingsOverride: patch.servingsOverride,
        note: patch.note,
      });
      if (patch.date) {
        await apiMoveMeal(id, patch.date);
      }
      router.refresh();
    });
  }

  async function handleDelete(id: number) {
    const meal = mealPlans.find((m) => m.id === id);
    setMealPlans((prev) => prev.filter((m) => m.id !== id));
    await withBusy(async () => {
      // Always subtract the meal's shopping-list contributions so the list
      // and the plan stay in sync. For meals with no shopping impact this
      // is identical to a plain delete (no sources → nothing to subtract).
      if (meal?.hasShoppingImpact) {
        await apiDeleteMealWithShopping(id, "subtract");
      } else {
        await apiDeleteMeal(id);
      }
      router.refresh();
    });
  }

  async function handleReorder(mealId: number, direction: "up" | "down") {
    const meal = mealPlans.find((m) => m.id === mealId);
    if (meal) {
      const sameDay = mealPlans
        .filter((m) => m.date === meal.date)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const idx = sameDay.findIndex((m) => m.id === mealId);
      const canSwapInDay =
        (direction === "up" && idx > 0) ||
        (direction === "down" && idx >= 0 && idx < sameDay.length - 1);

      if (canSwapInDay) {
        // Within-day: swap sort_order with the adjacent neighbour.
        const swapIdx = direction === "up" ? idx - 1 : idx + 1;
        const a = sameDay[idx];
        const b = sameDay[swapIdx];
        setMealPlans((prev) =>
          prev.map((m) => {
            if (m.id === a.id) return { ...m, sortOrder: b.sortOrder };
            if (m.id === b.id) return { ...m, sortOrder: a.sortOrder };
            return m;
          }),
        );
      } else {
        // Cross-day: walk one calendar day in the requested direction. Mirror
        // the server's `reorderUp`/`reorderDown` semantics — bottom-of-prev
        // for ↑ (max+1) and top-of-next for ↓ (min-1). Not bounded by the
        // visible page.
        const targetDate = addDays(meal.date, direction === "up" ? -1 : 1);
        const onTarget = mealPlans.filter((m) => m.date === targetDate);
        let newSort = 0;
        if (onTarget.length > 0) {
          newSort =
            direction === "up"
              ? Math.max(...onTarget.map((m) => m.sortOrder)) + 1
              : Math.min(...onTarget.map((m) => m.sortOrder)) - 1;
        }
        setMealPlans((prev) =>
          prev.map((m) =>
            m.id === mealId
              ? { ...m, date: targetDate, sortOrder: newSort }
              : m,
          ),
        );
      }
    }
    await withBusy(async () => {
      await apiReorderMeal(mealId, direction);
      router.refresh();
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as DragData | undefined;
    if (data) setActiveDrag(data);
    // Capture the source element's initial size so DayCell can render a
    // phantom placeholder of the same shape during the drag.
    const rect = event.active.rect.current.initial;
    if (rect) setDragSourceSize({ width: rect.width, height: rect.height });
    // Re-arm the fly-back animation for the next invalid drop.
    setDropAnimation(defaultDropAnimation);
  }

  function handleDragMove(event: DragMoveEvent) {
    const over = event.over;
    if (!over) {
      if (dropTarget != null) setDropTarget(null);
      return;
    }
    const overData = over.data.current as DropData | undefined;
    // Hovering the "+" affordance at the bottom of a non-empty day counts
    // as "below the last meal" — render the placeholder there.
    if (overData?.type === "day-end") {
      setDropTarget((curr) =>
        curr?.mealId === overData.lastMealId && curr.side === "below"
          ? curr
          : { mealId: overData.lastMealId, side: "below" },
      );
      return;
    }
    if (overData?.type !== "meal") {
      if (dropTarget != null) setDropTarget(null);
      return;
    }
    // Switch above/below at the target's vertical midpoint based on the
    // CURSOR position, not the dragged element's center. (Element center
    // depends on where the user grabbed the source — grabbing the top
    // edge would shift the center down a full card-height and flip the
    // side too early as the cursor entered a same-sized target.)
    let side: "above" | "below" = "above";
    const startEvent = event.activatorEvent as
      | PointerEvent
      | MouseEvent
      | undefined;
    if (startEvent && typeof startEvent.clientY === "number") {
      const cursorY = startEvent.clientY + event.delta.y;
      const overCenter = over.rect.top + over.rect.height / 2;
      side = cursorY < overCenter ? "above" : "below";
    }
    setDropTarget((curr) =>
      curr?.mealId === overData.mealId && curr.side === side
        ? curr
        : { mealId: overData.mealId, side },
    );
  }

  function handleDragCancel() {
    // Cancel (Escape, etc.) falls back to fly-back — it's the conventional
    // "this wasn't a real drop" signal.
    setActiveDrag(null);
    setDropTarget(null);
    setDragSourceSize(null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const data = event.active.data.current as DragData | undefined;
    const over = event.over;
    const dropData = over?.data.current as DropData | undefined;
    const isValidDrop =
      data != null &&
      (dropData?.type === "day" ||
        dropData?.type === "meal" ||
        dropData?.type === "day-end");

    // Resolve the target meal + side based on what the user actually
    // dropped onto:
    //   - meal card → use the live `dropTarget` (cursor-vs-centroid)
    //   - day-end ("+" button)     → "below" the last meal of the day
    //   - day cell background       → no specific meal (append)
    let targetMealId: number | null = null;
    let side: "above" | "below" = "above";
    if (dropData?.type === "meal") {
      targetMealId = dropData.mealId;
      if (dropTarget?.mealId === dropData.mealId) side = dropTarget.side;
    } else if (dropData?.type === "day-end") {
      targetMealId = dropData.lastMealId;
      side = "below";
    }

    if (isValidDrop) {
      // Suppress the fly-back so the overlay just disappears.
      setDropAnimation(null);
    }
    setActiveDrag(null);
    setDropTarget(null);
    setDragSourceSize(null);
    if (!isValidDrop || !data || !dropData) return;

    const targetDate = dropData.date;

    // Recipe → some drop target = create a new meal there.
    if (data.type === "recipe") {
      const recipe = recipes.find((r) => r.id === data.recipeId);
      if (!recipe) return;
      const portions = defaultMealPortions(recipe.servings);
      const optimistic = makeOptimisticMeal(recipe, targetDate, portions, null);
      setMealPlans((prev) =>
        insertOptimisticMeal(prev, optimistic, targetDate, targetMealId, side),
      );
      await withBusy(async () => {
        const { id: realId } = await apiCreateMeal({
          recipeId: data.recipeId,
          date: targetDate,
          servingsOverride: portions,
        });
        if (targetMealId != null) {
          const dayIds = orderedIdsForDate(
            targetDate,
            optimistic.id,
            realId,
            targetMealId,
            side,
          );
          if (dayIds) await apiReorderDay(targetDate, dayIds);
        }
        router.refresh();
      });
      return;
    }

    if (data.type === "meal") {
      // Same meal: no-op.
      if (targetMealId === data.mealId) return;

      const sameDay = data.sourceDate === targetDate;

      if (sameDay && targetMealId != null) {
        reorderWithinDay(data.mealId, targetMealId, targetDate, side);
        return;
      }

      if (!sameDay) {
        moveAcrossDays(data.mealId, targetDate, targetMealId, side);
        return;
      }

      // Same day, dropped on the day-cell background — no semantic change.
    }
  }

  /** Re-orders `mealPlans` so `optimistic` slots into the right place. */
  function insertOptimisticMeal(
    prev: MealPlanView[],
    optimistic: MealPlanView,
    targetDate: string,
    targetMealId: number | null,
    side: "above" | "below",
  ): MealPlanView[] {
    if (targetMealId == null) return [...prev, optimistic];
    const dayMeals = prev
      .filter((m) => m.date === targetDate)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = dayMeals.findIndex((m) => m.id === targetMealId);
    const insertIdx =
      idx < 0
        ? dayMeals.length
        : idx + (side === "below" ? 1 : 0);
    const reordered = [...dayMeals];
    reordered.splice(insertIdx, 0, optimistic);
    const idToOrder = new Map(reordered.map((m, i) => [m.id, i]));
    return [
      ...prev.filter((m) => m.date !== targetDate),
      ...prev
        .filter((m) => m.date === targetDate)
        .map((m) => ({ ...m, sortOrder: idToOrder.get(m.id) ?? m.sortOrder })),
      { ...optimistic, sortOrder: idToOrder.get(optimistic.id) ?? 0 },
    ];
  }

  function orderedIdsForDate(
    date: string,
    tempId: number,
    realId: number,
    targetMealId: number,
    side: "above" | "below",
  ): number[] | null {
    const dayMeals = mealPlans
      .filter((m) => m.date === date)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const baseIds = dayMeals.map((m) => m.id).filter((id) => id !== tempId);
    const idx = baseIds.indexOf(targetMealId);
    if (idx < 0) return null;
    const insertIdx = idx + (side === "below" ? 1 : 0);
    return [...baseIds.slice(0, insertIdx), realId, ...baseIds.slice(insertIdx)];
  }

  function reorderWithinDay(
    activeMealId: number,
    overMealId: number,
    date: string,
    side: "above" | "below",
  ) {
    const sameDay = mealPlans
      .filter((m) => m.date === date)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const activeIdx = sameDay.findIndex((m) => m.id === activeMealId);
    const overIdx = sameDay.findIndex((m) => m.id === overMealId);
    if (activeIdx < 0 || overIdx < 0) return;

    // Insert above ⇒ at overIdx; below ⇒ overIdx + 1. Then, because we
    // remove `active` first, indices after activeIdx shift down by one —
    // so adjust insertAt if the active was earlier in the list.
    let insertAt = overIdx + (side === "below" ? 1 : 0);
    if (activeIdx < insertAt) insertAt -= 1;
    if (activeIdx === insertAt) return; // no-op

    const reordered = [...sameDay];
    const [moved] = reordered.splice(activeIdx, 1);
    reordered.splice(insertAt, 0, moved);
    const orderedIds = reordered.map((m) => m.id);

    setMealPlans((prev) =>
      prev.map((m) => {
        if (m.date !== date) return m;
        const idx = orderedIds.indexOf(m.id);
        return idx >= 0 ? { ...m, sortOrder: idx } : m;
      }),
    );
    withBusy(async () => {
      await apiReorderDay(date, orderedIds);
      router.refresh();
    });
  }

  function moveAcrossDays(
    activeMealId: number,
    targetDate: string,
    targetMealId: number | null,
    side: "above" | "below",
  ) {
    // Optimistic: move the meal into the target day at the requested slot.
    setMealPlans((prev) => {
      const targetDayMeals = prev
        .filter((m) => m.date === targetDate)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      let insertIdx = targetDayMeals.length;
      if (targetMealId != null) {
        const idx = targetDayMeals.findIndex((m) => m.id === targetMealId);
        if (idx >= 0) insertIdx = idx + (side === "below" ? 1 : 0);
      }
      const targetIds = [
        ...targetDayMeals.slice(0, insertIdx).map((m) => m.id),
        activeMealId,
        ...targetDayMeals.slice(insertIdx).map((m) => m.id),
      ];
      return prev.map((m) => {
        if (m.id === activeMealId) {
          const newIdx = targetIds.indexOf(activeMealId);
          return { ...m, date: targetDate, sortOrder: newIdx };
        }
        if (m.date === targetDate) {
          const newIdx = targetIds.indexOf(m.id);
          return newIdx >= 0 ? { ...m, sortOrder: newIdx } : m;
        }
        return m;
      });
    });

    withBusy(async () => {
      await apiMoveMeal(activeMealId, targetDate);
      if (targetMealId != null) {
        const targetDayMeals = mealPlans
          .filter((m) => m.date === targetDate || m.id === activeMealId)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        const idx = targetDayMeals.findIndex((m) => m.id === targetMealId);
        if (idx >= 0) {
          const ids = targetDayMeals
            .filter((m) => m.id !== activeMealId)
            .map((m) => m.id);
          ids.splice(idx + (side === "below" ? 1 : 0), 0, activeMealId);
          await apiReorderDay(targetDate, ids);
        }
      }
      router.refresh();
    });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  return (
    <DndContext
      // Stable `id` keeps @dnd-kit's internal `DndDescribedBy-{n}` ARIA id
      // deterministic across server/client. Without it the module-level
      // counter advances differently in dev (StrictMode double-mount), which
      // triggers a hydration mismatch on every draggable's `aria-describedby`.
      id="planner-dnd"
      sensors={sensors}
      // `pointerWithin` only resolves a droppable when the pointer is
      // actually inside its rect, so releasing in empty space is a true
      // no-op (vs. `closestCenter`, which would snap to the nearest day).
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* The negative bottom margin on desktop cancels AppShell's
          main `md:pb-12` (3rem) + the container's `py-6` bottom (1.5rem)
          so the sticky recipe panel can reach the actual viewport bottom.
          Mobile keeps the natural padding because the bottom-nav lives there. */}
      <div className="flex flex-col gap-4 md:-mb-[4.5rem]">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Plan</h1>
          <div className="flex items-center gap-2">
            <DaysVisibleSelect
              value={settings.daysVisible}
              onChange={handleDaysVisibleChange}
            />
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={goPrevious} aria-label="Vorherige">
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="sm" onClick={goToday}>
                Heute
              </Button>
              <Button variant="ghost" size="icon" onClick={goNext} aria-label="Nächste">
                <ChevronRight />
              </Button>
            </div>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_380px]">
          {/* Small visual cushion below the last day-cell. The outer
              `md:-mb-[4.5rem]` cancelled the AppShell's bottom padding
              globally so the sticky recipe panel can reach the viewport
              bottom; the calendar column just needs a thin buffer. */}
          <div className="flex flex-col gap-2 md:pb-4">
            <button
              type="button"
              onClick={goPrevious}
              aria-label="Vorherige"
              className="flex items-center justify-center gap-2 rounded-md border border-dashed border-[var(--color-border)] py-2 text-xs text-[var(--color-muted-fg)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            >
              <ChevronUp className="size-4" aria-hidden />
              <span>Vorherige</span>
            </button>
            {dates.map((d) => (
              <DayCell
                key={d}
                date={d}
                isToday={d === today}
                meals={mealsByDate.get(d) ?? []}
                onEditMeal={(meal) => setEditing(meal)}
                onReorderUp={(id) => handleReorder(id, "up")}
                onReorderDown={(id) => handleReorder(id, "down")}
                onDeleteMeal={(id) => handleDelete(id)}
                onAddMeal={(date) => setAddingForDate(date)}
                onPreviewRecipe={(id) => setPreviewRecipeId(id)}
                dropTarget={dropTarget}
                dragSourceSize={dragSourceSize}
                draggable={true}
              />
            ))}
            <button
              type="button"
              onClick={goNext}
              aria-label="Nächste"
              className="flex items-center justify-center gap-2 rounded-md border border-dashed border-[var(--color-border)] py-2 text-xs text-[var(--color-muted-fg)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            >
              <ChevronDown className="size-4" aria-hidden />
              <span>Nächste</span>
            </button>
          </div>
          <RecipePanel
            recipes={recipes}
            allTags={allTags}
            recipeUsage={recipeUsage}
            today={today}
            onPreview={(id) => setPreviewRecipeId(id)}
          />
        </div>
      </div>

      {/* The overlay is portaled to <body> so it escapes any `overflow:auto`
          ancestor (notably the recipe list pane). The in-place draggable is
          hidden during the drag so the user only ever sees one element. */}
      <DragOverlay dropAnimation={dropAnimation}>
        {activeDrag ? <DragPreview drag={activeDrag} recipes={recipes} mealPlans={mealPlans} /> : null}
      </DragOverlay>

      <MealEditor
        meal={editing}
        onClose={() => setEditing(null)}
        onSave={handleSaveEdit}
        onDelete={handleDelete}
      />
      <AddMealModal
        date={addingForDate}
        recipes={recipes}
        allTags={allTags}
        onClose={() => setAddingForDate(null)}
        onSelect={handleAdd}
      />
      <RecipePreviewDialog
        recipeId={previewRecipeId}
        onClose={() => setPreviewRecipeId(null)}
      />
    </DndContext>
  );
}

const DAYS_VISIBLE_PRESETS = [1, 3, 5, 7, 10, 14, 21, 28] as const;

/**
 * Inline picker for the planner.days_visible setting. Persists immediately
 * to the API and triggers a router.refresh() so the page re-derives the
 * visible range. If the user has a custom value set (e.g. via Einstellungen),
 * it appears in the dropdown alongside the presets so they can switch back.
 */
function DaysVisibleSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void | Promise<void>;
}) {
  const options = React.useMemo(() => {
    const presets = DAYS_VISIBLE_PRESETS as unknown as number[];
    return presets.includes(value) ? presets : [...presets, value].sort((a, b) => a - b);
  }, [value]);

  return (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <span className="sr-only">Sichtbare Tage</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Sichtbare Tage"
        className="h-9 min-h-9 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 pr-7 text-sm transition-colors hover:bg-[var(--color-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n === 1 ? "1 Tag" : `${n} Tage`}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Visual shown in the DragOverlay portal while a drag is active. Mirrors the
 * recipe row / meal card layout closely enough that the user perceives "their"
 * card following the pointer — but it's a presentational copy with no DnD
 * hooks, since the overlay is rendered outside the React DnD tree.
 */
function DragPreview({
  drag,
  recipes,
  mealPlans,
}: {
  drag: DragData;
  recipes: RecipeListItem[];
  mealPlans: MealPlanView[];
}) {
  // Match the source element's measured width so the ghost reads as the
  // "same" card the user grabbed (otherwise overlays default to their
  // content width — which clipped recipe rows down to ~half the source).
  const { active } = useDndContext();
  const sourceWidth = active?.rect.current.initial?.width;
  const widthStyle = sourceWidth ? { width: `${sourceWidth}px` } : undefined;

  if (drag.type === "recipe") {
    const recipe = recipes.find((r) => r.id === drag.recipeId);
    if (!recipe) return null;
    return (
      <div
        style={widthStyle}
        className="flex cursor-grabbing items-center gap-2 rounded-md border border-[var(--color-accent)] bg-[var(--color-card)] p-2 text-sm shadow-xl"
      >
        {recipe.photoPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/v1/${recipe.photoPath}`}
            alt=""
            className="size-9 shrink-0 rounded object-cover"
          />
        ) : (
          <div className="size-9 shrink-0 rounded bg-[var(--color-muted)]" />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 truncate font-medium">
            <DietBadge
              isVegan={recipe.isVegan}
              isVegetarian={recipe.isVegetarian}
              size="sm"
            />
            <span className="truncate">{recipe.title}</span>
          </span>
          {recipe.tags.length > 0 ? (
            <span className="truncate text-xs text-[var(--color-muted-fg)]">
              {recipe.tags.slice(0, 3).join(" · ")}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  const meal = mealPlans.find((m) => m.id === drag.mealId);
  if (!meal) return null;
  return (
    <div
      style={widthStyle}
      className="flex cursor-grabbing items-center gap-2 rounded-[var(--radius)] border border-[var(--color-accent)] bg-[var(--color-card)] p-2 shadow-xl"
    >
      {meal.recipe.photoPath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/v1/${meal.recipe.photoPath}`}
          alt=""
          className="size-12 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="size-12 shrink-0 rounded bg-[var(--color-muted)]" />
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <DietBadge
            isVegan={meal.recipe.isVegan}
            isVegetarian={meal.recipe.isVegetarian}
            size="sm"
          />
          <span className="truncate text-sm font-medium">
            {meal.recipe.title}
          </span>
        </div>
        <span className="text-xs text-[var(--color-muted-fg)]">
          {meal.servings} Portionen
          {meal.note ? ` · ${meal.note}` : ""}
        </span>
      </div>
    </div>
  );
}
