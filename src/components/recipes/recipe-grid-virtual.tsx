"use client";

import * as React from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { RecipeCard } from "./recipe-card";
import { RecipeGridSkeleton } from "./recipe-grid-skeleton";
import {
  RANDOM_SAMPLE_SIZE,
  sampleRecipes,
  useRandomize,
} from "./randomize-context";
import type { RecipeListItem } from "@/lib/recipes/types";

type Filters = {
  q?: string;
  must?: string;
  not?: string;
  diet?: string;
  update?: string;
};

type Props = {
  /** First page rendered on the server, shown instantly while the full list
   *  loads. */
  initialRecipes: RecipeListItem[];
  /** Total number of recipes matching the current filters (the server knows
   *  this even though it only renders the first page). */
  initialMatchedCount: number;
  /** Total recipes ignoring filters — drives the empty-state wording. */
  totalUnfiltered: number;
  filters: Filters;
};

// Mirror the Tailwind grid breakpoints (sm/lg/xl/2xl) so windowed rows hold
// the same number of cards the CSS grid would show.
function columnsForWidth(w: number): number {
  if (w >= 1536) return 5;
  if (w >= 1280) return 4;
  if (w >= 1024) return 3;
  if (w >= 640) return 2;
  return 1;
}

function useColumns(): number {
  // VirtualGrid only mounts on the client, so `window` is available for the
  // initial value — avoids a one-frame flash of the 1-column layout.
  const [cols, setCols] = React.useState(() =>
    typeof window === "undefined" ? 1 : columnsForWidth(window.innerWidth),
  );
  React.useEffect(() => {
    const update = () => setCols(columnsForWidth(window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return cols;
}

function countLabel(
  shown: number,
  totalUnfiltered: number,
  filtersActive: boolean,
): string {
  if (shown === 0) {
    return filtersActive
      ? "Keine Treffer mit den aktuellen Filtern."
      : "Noch keine Rezepte – jetzt das erste anlegen.";
  }
  if (shown < totalUnfiltered) return `${shown} von ${totalUnfiltered} Rezepten.`;
  return `${shown} Rezept${shown === 1 ? "" : "e"}.`;
}

function randomLabel(shown: number, matched: number): string {
  const noun = shown === 1 ? "zufälliges Rezept" : "zufällige Rezepte";
  const hits = matched === 1 ? "Treffer" : "Treffern";
  return `${shown} ${noun} von ${matched} ${hits}.`;
}

export function RecipeGridVirtual({
  initialRecipes,
  initialMatchedCount,
  totalUnfiltered,
  filters,
}: Props) {
  const { q, must, not, diet, update } = filters;
  const filterKey = `${q ?? ""}|${must ?? ""}|${not ?? ""}|${diet ?? ""}|${update ?? ""}`;
  const filtersActive = Boolean(q?.trim() || must || not || diet || update);

  // `loaded` is tagged with the filter key it belongs to, so a stale result
  // from a previous filter never shows after the filter changes — we fall
  // back to the freshly server-rendered `initialRecipes` until the matching
  // fetch lands.
  const [loaded, setLoaded] = React.useState<{
    key: string;
    recipes: RecipeListItem[];
  } | null>(null);
  const [errored, setErrored] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    setErrored(false);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (must) params.set("must", must);
    if (not) params.set("not", not);
    if (diet) params.set("diet", diet);
    if (update) params.set("update", update);
    const qs = params.toString();
    fetch(`/api/v1/recipes${qs ? `?${qs}` : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((data: { recipes: RecipeListItem[] }) => {
        if (active) setLoaded({ key: filterKey, recipes: data.recipes });
      })
      .catch(() => {
        if (active) setErrored(true);
      });
    return () => {
      active = false;
    };
  }, [filterKey, q, must, not, diet, update]);

  const full = loaded?.key === filterKey ? loaded.recipes : null;
  const recipes = full ?? initialRecipes;
  const shown = full ? full.length : initialMatchedCount;

  const {
    active: randomActive,
    nonce: randomNonce,
    setAvailable,
  } = useRandomize();

  // Tell the control how many recipes it could sample from (drives disabling).
  // Exiting randomization on a filter change is handled by RandomizeProvider's
  // `resetKey` (the page passes the same filter key).
  React.useEffect(() => {
    setAvailable(full ? full.length : initialMatchedCount);
  }, [full, initialMatchedCount, setAvailable]);

  // Resample on each roll. Only meaningful once the full list has loaded; the
  // random subset must come from the complete filtered set, not the SSR page.
  const sample = React.useMemo(() => {
    if (!randomActive || !full) return null;
    return sampleRecipes(full, RANDOM_SAMPLE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [randomActive, randomNonce, full]);

  return (
    <div>
      <p className="mt-2 text-sm text-[var(--color-muted-fg)]">
        {randomActive && sample
          ? randomLabel(sample.length, full ? full.length : initialMatchedCount)
          : countLabel(shown, totalUnfiltered, filtersActive)}
        {errored ? (
          <span className="ml-2 text-[var(--color-danger)]">
            Liste konnte nicht geladen werden.
          </span>
        ) : null}
      </p>
      {randomActive ? (
        sample ? (
          <StaticGrid recipes={sample} pendingMore={false} />
        ) : (
          <div className="mt-6">
            <RecipeGridSkeleton count={RANDOM_SAMPLE_SIZE} />
          </div>
        )
      ) : recipes.length === 0 ? null : full ? (
        <VirtualGrid recipes={full} />
      ) : (
        <StaticGrid recipes={initialRecipes} pendingMore={shown > initialRecipes.length} />
      )}
    </div>
  );
}

/** Server-matching first paint: a plain CSS grid of the SSR'd page. */
function StaticGrid({
  recipes,
  pendingMore,
}: {
  recipes: RecipeListItem[];
  pendingMore: boolean;
}) {
  return (
    <>
      <div className="mt-6 grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {recipes.map((r) => (
          <RecipeCard key={r.id} recipe={r} />
        ))}
      </div>
      {pendingMore ? (
        <div className="mt-4">
          <RecipeGridSkeleton count={5} />
        </div>
      ) : null}
    </>
  );
}

/** Windowed grid over the full list — only on-screen rows are in the DOM. */
function VirtualGrid({ recipes }: { recipes: RecipeListItem[] }) {
  const columns = useColumns();
  const parentRef = React.useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = React.useState(0);

  // Layout effect so the window virtualizer knows the grid's document offset
  // before the first paint, avoiding an initial mis-positioned frame.
  React.useLayoutEffect(() => {
    setScrollMargin(parentRef.current?.offsetTop ?? 0);
  }, []);

  const rowCount = Math.ceil(recipes.length / columns);
  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => 360,
    overscan: 3,
    scrollMargin,
  });

  // Column count and the measured row heights change together on resize.
  React.useEffect(() => {
    virtualizer.measure();
  }, [columns, virtualizer]);

  return (
    <div
      ref={parentRef}
      className="relative mt-6"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const start = row.index * columns;
        const rowRecipes = recipes.slice(start, start + columns);
        return (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{
              transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            <div
              className="grid gap-4 pb-4"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
            >
              {rowRecipes.map((r) => (
                <RecipeCard key={r.id} recipe={r} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
