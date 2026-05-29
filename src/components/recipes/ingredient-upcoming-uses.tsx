"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarClock, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { isOptionalIngredient } from "@/lib/recipes/optional";
import { formatWeekdayShortDe, formatDayMonthDe } from "@/lib/meal-plans/dates";
import type {
  UpcomingIngredientUses,
  UpcomingUse,
} from "@/lib/meal-plans/upcoming-uses";

type Status =
  | { kind: "loading" }
  | { kind: "ready"; data: UpcomingIngredientUses }
  | { kind: "error"; message: string }
  | { kind: "absent" };

type ContextValue = {
  status: Status;
  /** Width of the calendar-icon column. `null` means no column is reserved
   *  (no meal context at all). */
  columnWidth: string | null;
};

const Ctx = React.createContext<ContextValue>({
  status: { kind: "absent" },
  columnWidth: null,
});

type ProviderProps = {
  mealPlanId: number | null;
  children: React.ReactNode;
};

/**
 * Fetches the upcoming-ingredient-uses payload for a meal once when mounted.
 * Children read the result via {@link useUpcomingUses} and decide per row
 * whether to render an icon. When `mealPlanId` is null the provider is a
 * no-op — no column is reserved, no icons appear.
 */
export function UpcomingUsesProvider({ mealPlanId, children }: ProviderProps) {
  const [status, setStatus] = React.useState<Status>(() =>
    mealPlanId == null ? { kind: "absent" } : { kind: "loading" },
  );

  // Resetting status synchronously on prop change is the simplest way to
  // keep the icon column from showing stale "ready" rows during a meal
  // switch. Same pattern as the other in-tree fetchers (see
  // recipe-grid-virtual.tsx, use-recipe-catalog.ts).
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (mealPlanId == null) {
      setStatus({ kind: "absent" });
      return;
    }
    let cancelled = false;
    setStatus({ kind: "loading" });
    fetch(`/api/v1/meal-plans/${mealPlanId}/upcoming-ingredient-uses`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = (await res.json()) as UpcomingIngredientUses;
        if (!cancelled) setStatus({ kind: "ready", data });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatus({
          kind: "error",
          message: e instanceof Error ? e.message : "Fehler",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [mealPlanId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const value = React.useMemo<ContextValue>(
    () => ({
      status,
      columnWidth: mealPlanId == null ? null : "1rem",
    }),
    [status, mealPlanId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUpcomingUsesColumnWidth(): string | null {
  return React.useContext(Ctx).columnWidth;
}

/**
 * Renders a calendar-clock icon button for a single ingredient row. The
 * button only appears when (a) the provider is in `ready` state and (b)
 * the ingredient has at least one upcoming use. Otherwise an empty span
 * with the same width keeps the qty/diet/name columns column-aligned.
 *
 * When the provider is absent (no meal context), this returns null and
 * the parent must avoid reserving the column at all — use
 * {@link useUpcomingUsesColumnWidth} to decide.
 */
export function UpcomingUsesButton({
  ingredientId,
  ingredientName,
}: {
  ingredientId: number | null;
  ingredientName: string;
}) {
  const { status, columnWidth } = React.useContext(Ctx);
  if (columnWidth == null) return null;

  const uses =
    status.kind === "ready" && ingredientId != null
      ? status.data.byIngredientId[ingredientId]
      : undefined;
  const hasUses = !!uses && uses.length > 0;

  return (
    <span
      className="inline-flex h-[1lh] shrink-0 items-center justify-center"
      style={{ width: columnWidth }}
    >
      {status.kind === "loading" ? (
        <Loader2
          className="size-3 animate-spin text-[var(--color-muted-fg)] opacity-50"
          aria-hidden="true"
        />
      ) : hasUses ? (
        <UpcomingUsesPopover
          ingredientName={ingredientName}
          uses={uses!}
        />
      ) : null}
    </span>
  );
}

function UpcomingUsesPopover({
  ingredientName,
  uses,
}: {
  ingredientName: string;
  uses: UpcomingUse[];
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Weitere geplante Verwendungen von ${ingredientName}`}
          title="Weitere geplante Verwendungen"
          className={cn(
            "inline-flex size-4 items-center justify-center rounded-sm text-[var(--color-muted-fg)] transition-colors",
            "hover:text-[var(--color-fg)] hover:bg-[var(--color-muted)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
          )}
        >
          <CalendarClock className="size-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 w-72 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 shadow-md"
        >
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-fg)]">
            Wird auch geplant für
          </div>
          <div className="mt-0.5 text-sm font-semibold">{ingredientName}</div>
          <ul className="mt-2 space-y-1.5">
            {uses.map((u, idx) => (
              <UpcomingUseRow key={`${u.mealPlanId}-${idx}`} use={u} />
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function formatQty(q: number | null): string {
  if (q == null) return "";
  const rounded = Math.round(q * 100) / 100;
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(
    rounded,
  );
}

function UpcomingUseRow({ use }: { use: UpcomingUse }) {
  const optional = isOptionalIngredient(use);
  const qtyText =
    use.qty != null
      ? `${formatQty(use.qty)}${use.unitName ? ` ${use.unitName}` : ""}`
      : "";
  return (
    <li
      className={cn(
        "flex items-baseline gap-2 text-sm",
        optional && "italic opacity-65",
      )}
    >
      <span className="shrink-0 font-mono text-xs text-[var(--color-muted-fg)] tabular-nums">
        {formatWeekdayShortDe(use.date)} {formatDayMonthDe(use.date)}
      </span>
      <span className="flex-1 truncate">{use.recipeTitle}</span>
      {qtyText ? (
        <span className="shrink-0 font-mono text-xs text-[var(--color-muted-fg)]">
          {qtyText}
        </span>
      ) : null}
    </li>
  );
}
