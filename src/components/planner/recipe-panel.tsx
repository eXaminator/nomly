"use client";

import * as React from "react";
import { useDraggable, useDndContext, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Eye, Trash2 } from "lucide-react";
import type { DragData } from "./types";
import { DietBadge } from "@/components/recipes/diet-badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlannerRecipe } from "@/lib/recipes/types";
import type { RecipeUsageStats } from "@/lib/meal-plans/types";
import { formatDayMonthDe } from "@/lib/meal-plans/dates";
import { cn } from "@/lib/cn";
import {
  EMPTY_RECIPE_FILTER,
  RecipeFilterBar,
  recipeFilterToQuery,
  type RecipeFilterValue,
} from "@/components/recipes/recipe-filter-bar";
import {
  RandomizeProvider,
  useRandomSample,
} from "@/components/recipes/randomize-context";
import { useFilteredRecipes } from "./recipe-filter";

type Props = {
  allTags: string[];
  recipeUsage: Array<{ recipeId: number } & RecipeUsageStats>;
  today: string;
  /** Opens the shared recipe-preview dialog (owned by PlannerView). */
  onPreview: (recipeId: number) => void;
};

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`);
  const db = new Date(`${b}T00:00:00Z`);
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

function formatLastPlanned(iso: string, today: string): string {
  const diff = -daysBetween(today, iso); // iso < today → diff > 0
  if (diff === 1) return "Gestern";
  if (diff <= 7) return `vor ${diff} Tagen`;
  return formatDayMonthDe(iso);
}

function formatNextPlanned(iso: string, today: string): string {
  const diff = daysBetween(today, iso);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  if (diff <= 7) return `in ${diff} Tagen`;
  return formatDayMonthDe(iso);
}

/**
 * Recipe list shown alongside the meal planner. Reuses the shared
 * `RecipeFilterControls` + server-side `listRecipes` filtering (via
 * {@link useFilteredRecipes}) so the planner's filter behaves **exactly** like
 * the main `/rezepte` list — including the advanced search syntax (`zutat:`,
 * phrases, OR, negation, typo tolerance). Filter state lives in local React
 * state so it never touches the meal-plan URL (which owns `?from=`).
 *
 * Rendering is intentionally compact (small rows + drag handle + eye preview)
 * because the panel coexists with the calendar column.
 */
export function RecipePanel({
  allTags,
  recipeUsage,
  today,
  onPreview,
}: Props) {
  const [filter, setFilter] =
    React.useState<RecipeFilterValue>(EMPTY_RECIPE_FILTER);

  // The panel doubles as a "drop a meal here to remove it from the plan"
  // target. The overlay only appears while a *meal* is being dragged (dragging
  // a recipe out of the list shouldn't suggest removal).
  const { setNodeRef: setRemoveRef, isOver } = useDroppable({
    id: "planner-remove",
    data: { type: "remove" },
  });
  const { active } = useDndContext();
  const draggingMeal =
    (active?.data.current as DragData | undefined)?.type === "meal";

  return (
    <aside
      ref={setRemoveRef}
      className={cn(
        "relative hidden md:flex flex-col gap-3",
        // Stick the panel below the AppShell header (top-20 = 5rem) and give
        // it a DEFINITE full-viewport-minus-chrome height (not just max-h).
        // The inner list is virtualized, so its scroll viewport needs a real
        // bounded height — a content-sized container collapses toward the
        // row-height estimate and clips a single tall result (one recipe with
        // several tag lines) instead of scrolling. A fixed height makes the
        // `flex-1` scroll child a stable, full-height viewport.
        // Total chrome above the grid:
        //   AppShell header (4) + container pt (1.5) + planner header (2.5) + gap (1) ≈ 9rem.
        "md:sticky md:top-20 md:self-start md:h-[calc(100vh-9rem)]",
      )}
    >
      {draggingMeal ? (
        <div
          className={cn(
            // Visual only — pointer-events-none so dnd-kit's collision math
            // still resolves against the <aside> rect underneath.
            "pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-[var(--radius)] border-2 border-dashed p-4 text-center transition-colors",
            isOver
              ? "border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger),transparent_80%)]"
              : "border-[var(--color-border)] bg-[var(--color-bg)]/85 backdrop-blur-sm",
          )}
        >
          <Trash2
            className={cn(
              "size-8",
              isOver
                ? "text-[var(--color-danger)]"
                : "text-[var(--color-muted-fg)]",
            )}
          />
          <span
            className={cn(
              "text-sm font-medium",
              isOver
                ? "text-[var(--color-danger)]"
                : "text-[var(--color-muted-fg)]",
            )}
          >
            {isOver
              ? "Loslassen zum Entfernen"
              : "Mahlzeit hierher ziehen, um sie zu entfernen"}
          </span>
        </div>
      ) : null}
      <RandomizeProvider resetKey={recipeFilterToQuery(filter)}>
        <PanelRecipeList
          allTags={allTags}
          filter={filter}
          onFilterChange={setFilter}
          recipeUsage={recipeUsage}
          today={today}
          onPreview={onPreview}
        />
      </RandomizeProvider>
    </aside>
  );
}

/**
 * The filter bar + virtualized list, rendered inside {@link RandomizeProvider}
 * so the randomize control and the list sample together. When randomization is
 * active the list shows a few random recipes from the filtered set; otherwise
 * the full filtered catalog.
 */
function PanelRecipeList({
  allTags,
  filter,
  onFilterChange,
  recipeUsage,
  today,
  onPreview,
}: {
  allTags: string[];
  filter: RecipeFilterValue;
  onFilterChange: (next: RecipeFilterValue) => void;
  recipeUsage: Array<{ recipeId: number } & RecipeUsageStats>;
  today: string;
  onPreview: (recipeId: number) => void;
}) {
  const { recipes: filtered, loading, error } = useFilteredRecipes(filter);
  const { recipes: shown } = useRandomSample(filtered);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const usageByRecipe = React.useMemo(() => {
    const map = new Map<number, RecipeUsageStats>();
    for (const u of recipeUsage) {
      const { recipeId, ...stats } = u;
      map.set(recipeId, stats);
    }
    return map;
  }, [recipeUsage]);

  const rowVirtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 60,
    overscan: 8,
  });

  return (
    <>
      <RecipeFilterBar allTags={allTags} value={filter} onChange={onFilterChange} />
      {/* `pb-4` lives inside the scroll container so the last recipe has
          a bit of breathing room at the bottom when scrolled all the way.
          Rows are virtualized: only the on-screen slice is in the DOM, which
          keeps a large catalog cheap to render (and to keep draggable). */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1 pb-4">
        {loading && shown.length === 0 ? (
          <div className="space-y-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[52px] w-full" />
            ))}
          </div>
        ) : error && shown.length === 0 ? (
          <p className="text-sm text-[var(--color-danger)]">
            Liste konnte nicht geladen werden.
          </p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">Keine Treffer.</p>
        ) : (
          <div
            className="relative"
            style={{ height: rowVirtualizer.getTotalSize() }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const recipe = shown[virtualRow.index];
              return (
                <div
                  key={recipe.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className="pb-1.5">
                    <RecipeRow
                      recipe={recipe}
                      stats={usageByRecipe.get(recipe.id) ?? null}
                      today={today}
                      onPreview={onPreview}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function RecipeRow({
  recipe,
  stats,
  today,
  onPreview,
}: {
  recipe: PlannerRecipe;
  stats: RecipeUsageStats | null;
  today: string;
  onPreview: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `recipe:${recipe.id}`,
      data: { type: "recipe", recipeId: recipe.id },
    });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    // Hide the in-place row during drag — DragOverlay renders the moving
    // copy via a body-portal so the recipe panel's `overflow-y-auto` can't
    // clip it. Keeping `opacity: 0` preserves the row's slot.
    opacity: isDragging ? 0 : undefined,
  };
  // DietBadge renders nothing unless one of these is true; mirror that here
  // so the tags row isn't created just to hold an empty badge.
  const hasDiet = recipe.isVegan === true || recipe.isVegetarian === true;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex cursor-grab items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2 text-sm shadow-sm transition-colors hover:border-[var(--color-accent)] active:cursor-grabbing"
      {...listeners}
      {...attributes}
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
        <span className="truncate font-medium">{recipe.title}</span>
        {hasDiet || recipe.tags.length > 0 ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <DietBadge
              isVegan={recipe.isVegan}
              isVegetarian={recipe.isVegetarian}
              confidence={recipe.dietConfidence}
              size="sm"
            />
            {recipe.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-[var(--color-muted)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted-fg)]"
              >
                {tag}
              </span>
            ))}
            {recipe.tags.length > 3 ? (
              <span className="text-[10px] text-[var(--color-muted-fg)]">
                +{recipe.tags.length - 3}
              </span>
            ) : null}
          </div>
        ) : null}
        <RecipeUsageLine stats={stats} today={today} />
      </div>
      {/* Real <a> so cmd+click / ctrl+click / middle-click / "open in new
          tab" from the context menu work natively. A plain left-click is
          intercepted to open the in-page preview modal instead. The pointer
          events are stopped so the row's drag listeners don't pick them up. */}
      <a
        href={`/rezepte/${recipe.id}`}
        aria-label={`„${recipe.title}“ ansehen`}
        title="Ansehen (Cmd/Ctrl-Klick öffnet in neuem Tab)"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          onPreview(recipe.id);
        }}
        className={cn(
          "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md",
          "text-[var(--color-muted-fg)] transition-colors",
          "hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
        )}
      >
        <Eye className="size-4" aria-hidden />
      </a>
    </div>
  );
}

function RecipeUsageLine({
  stats,
  today,
}: {
  stats: RecipeUsageStats | null;
  today: string;
}) {
  if (!stats) return null;
  const { lastPlanned, nextPlanned, count30d } = stats;
  if (!lastPlanned && !nextPlanned && count30d === 0) return null;
  const parts: string[] = [];
  if (lastPlanned) parts.push(`Zuletzt ${formatLastPlanned(lastPlanned, today)}`);
  if (nextPlanned) parts.push(`Nächste ${formatNextPlanned(nextPlanned, today)}`);
  if (count30d > 0) parts.push(`${count30d}× / 30 T.`);
  return (
    <span className="truncate text-[11px] text-[var(--color-muted-fg)]/80">
      {parts.join(" · ")}
    </span>
  );
}
