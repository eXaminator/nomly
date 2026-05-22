"use client";

import * as React from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Eye } from "lucide-react";
import { DietBadge } from "@/components/recipes/diet-badge";
import { RecipeSearch } from "@/components/recipes/recipe-search";
import {
  TagFilterBar,
  type TagFilterValue,
} from "@/components/recipes/tag-filter-bar";
import type { RecipeListItem } from "@/lib/recipes/types";
import type { RecipeUsageStats } from "@/lib/meal-plans/types";
import { formatDayMonthDe } from "@/lib/meal-plans/dates";
import { cn } from "@/lib/cn";

type Props = {
  recipes: RecipeListItem[];
  allTags: string[];
  recipeUsage: Array<{ recipeId: number } & RecipeUsageStats>;
  today: string;
  /** Opens the shared recipe-preview dialog (owned by PlannerView). */
  onPreview: (recipeId: number) => void;
};

const EMPTY_TAG_VALUE: TagFilterValue = { must: [], not: [] };

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
 * `RecipeSearch` + `TagFilterBar` components in **controlled mode** so the
 * filter state lives in local React state and never touches the URL — the
 * planner already owns `?from=` and we don't want recipe filters leaking
 * into the meal-plan URL.
 *
 * Rendering is intentionally compact (small rows + drag handle + eye preview)
 * because the panel coexists with the calendar column.
 */
export function RecipePanel({
  recipes,
  allTags,
  recipeUsage,
  today,
  onPreview,
}: Props) {
  const [query, setQuery] = React.useState("");
  const [tagFilter, setTagFilter] = React.useState<TagFilterValue>(EMPTY_TAG_VALUE);

  const usageByRecipe = React.useMemo(() => {
    const map = new Map<number, RecipeUsageStats>();
    for (const u of recipeUsage) {
      const { recipeId, ...stats } = u;
      map.set(recipeId, stats);
    }
    return map;
  }, [recipeUsage]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const mustSet = new Set(tagFilter.must.map((t) => t.toLowerCase()));
    const notSet = new Set(tagFilter.not.map((t) => t.toLowerCase()));
    return recipes.filter((r) => {
      if (q.length > 0) {
        const hayTitle = r.title.toLowerCase();
        const hayTags = r.tags.join(" ").toLowerCase();
        if (!hayTitle.includes(q) && !hayTags.includes(q)) return false;
      }
      if (mustSet.size > 0 || notSet.size > 0) {
        const have = new Set(r.tags.map((t) => t.toLowerCase()));
        for (const m of mustSet) if (!have.has(m)) return false;
        for (const n of notSet) if (have.has(n)) return false;
      }
      return true;
    });
  }, [recipes, query, tagFilter]);

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col gap-3",
        // Stick the panel below the AppShell header (top-20 = 5rem). The
        // panel sits BELOW the planner header + container pt, so its max
        // height has to leave room for that chrome — otherwise the grid
        // row is taller than the viewport and the page scrolls "just to
        // fit the panel" even when the calendar is short.
        // Total chrome above the grid:
        //   AppShell header (4) + container pt (1.5) + planner header (2.5) + gap (1) ≈ 9rem.
        // Trade-off: on a long calendar, the panel's bottom edge stops
        // ~4rem above viewport bottom at scroll-end (since sticky-top is
        // 5rem, not 9rem). Acceptable — and far better than constant
        // forced scroll.
        "md:sticky md:top-20 md:self-start md:max-h-[calc(100vh-9rem)]",
      )}
    >
      <RecipeSearch value={query} onChange={setQuery} />
      {allTags.length > 0 ? (
        <TagFilterBar
          allTags={allTags}
          value={tagFilter}
          onChange={setTagFilter}
        />
      ) : null}
      {/* `pb-4` lives inside the scroll container so the last recipe has
          a bit of breathing room at the bottom when scrolled all the way. */}
      <div className="flex-1 space-y-1.5 overflow-y-auto pr-1 pb-4">
        {filtered.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">Keine Treffer.</p>
        ) : (
          filtered.map((recipe) => (
            <RecipeRow
              key={recipe.id}
              recipe={recipe}
              stats={usageByRecipe.get(recipe.id) ?? null}
              today={today}
              onPreview={onPreview}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function RecipeRow({
  recipe,
  stats,
  today,
  onPreview,
}: {
  recipe: RecipeListItem;
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
