import Link from "next/link";
import { Soup } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DietBadge } from "@/components/recipes/diet-badge";
import type { MealPlanView } from "@/lib/meal-plans/types";
import {
  formatDayMonthDe,
  formatWeekdayLongDe,
} from "@/lib/meal-plans/dates";
import { cn } from "@/lib/cn";

function dayLabel(iso: string, today: string): string {
  if (iso === today) return "Heute";
  return formatWeekdayLongDe(iso);
}

/**
 * Dashboard card: the planned meals for the given dates (today + the next
 * days), grouped by day. Each meal links to its recipe; the card links to the
 * full planner.
 */
export function UpcomingMealsCard({
  dates,
  meals,
  today,
  className,
}: {
  /** ISO dates to show, in order (first entry is today). */
  dates: string[];
  meals: MealPlanView[];
  today: string;
  className?: string;
}) {
  const byDate = new Map<string, MealPlanView[]>();
  for (const meal of meals) {
    const list = byDate.get(meal.date) ?? [];
    list.push(meal);
    byDate.set(meal.date, list);
  }

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-baseline justify-between">
        <CardTitle>Nächste Mahlzeiten</CardTitle>
        <Link
          href="/plan"
          className="text-sm font-medium text-[var(--color-accent)] hover:underline"
        >
          Zum Plan →
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {dates.map((date) => {
          const dayMeals = byDate.get(date) ?? [];
          return (
            <div key={date}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-sm font-semibold",
                    date === today
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-fg)]",
                  )}
                >
                  {dayLabel(date, today)}
                </span>
                <span className="text-xs text-[var(--color-muted-fg)]">
                  {formatDayMonthDe(date)}
                </span>
              </div>
              {dayMeals.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-fg)]">
                  Nichts geplant.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {dayMeals.map((meal) => (
                    <li key={meal.id}>
                      <Link
                        href={`/rezepte/${meal.recipe.id}?meal=${meal.id}`}
                        className="group flex min-h-11 items-center gap-2.5 rounded-md px-2 -mx-2 hover:bg-[var(--color-muted)]/50"
                      >
                        {meal.recipe.photoPath ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/v1/${meal.recipe.photoPath}`}
                            alt=""
                            className="size-9 shrink-0 rounded object-cover"
                          />
                        ) : (
                          <div className="size-9 shrink-0 rounded bg-[var(--color-muted)]" />
                        )}
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          <DietBadge
                            isVegan={meal.recipe.isVegan}
                            isVegetarian={meal.recipe.isVegetarian}
                            confidence={meal.recipe.dietConfidence}
                            size="sm"
                          />
                          <span className="min-w-0 truncate text-sm font-medium text-[var(--color-fg)] group-hover:underline">
                            {meal.recipe.title}
                          </span>
                          {meal.isLeftover ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-muted)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
                              <Soup className="size-3" />
                              Reste
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-[var(--color-muted-fg)]">
                          {meal.servings} Port.
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
