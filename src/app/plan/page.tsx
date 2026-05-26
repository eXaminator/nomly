import { asc } from "drizzle-orm";
import { AppShell } from "@/components/layout/app-shell";
import { PlannerView } from "@/components/planner/planner-view";
import { db } from "@/db";
import { tag } from "@/db/schema";
import {
  getRecipeUsageStats,
  listByDateRange,
} from "@/lib/meal-plans/service";
import { listRecipes } from "@/lib/recipes/service";
import { getPlannerSettings } from "@/lib/settings/planner";
import {
  alignToStartWeekday,
  buildRange,
  isIsoDate,
  todayIso,
} from "@/lib/meal-plans/dates";
import { getEventsForRange } from "@/lib/ical/events";
import { refreshStaleEnabledFeeds } from "@/lib/ical/fetch";

export const dynamic = "force-dynamic";

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from: fromParam } = await searchParams;
  const settings = getPlannerSettings();
  const today = todayIso();
  const from =
    fromParam && isIsoDate(fromParam)
      ? fromParam
      : alignToStartWeekday(today, settings.startWeekday);
  const range = buildRange(from, settings.daysVisible);
  // Kick off background refresh of stale iCal feeds before reading events;
  // the call returns immediately and the next render picks up any new bodies.
  refreshStaleEnabledFeeds();
  const calendarEvents = getEventsForRange(range.from, range.to);
  const mealPlans = listByDateRange(range.from, range.to);
  // Recipe-list filter state lives client-side in RecipePanel (it intentionally
  // doesn't persist to the URL so the planner's own `?from=` stays unique),
  // so we ship the whole catalog and the panel filters in the browser.
  const recipes = listRecipes();
  const recipeUsage = Array.from(getRecipeUsageStats(today).entries()).map(
    ([recipeId, stats]) => ({ recipeId, ...stats }),
  );
  const allTags = db
    .select({ name: tag.name })
    .from(tag)
    .orderBy(asc(tag.name))
    .all()
    .map((t) => t.name);

  return (
    <AppShell>
      <PlannerView
        today={today}
        settings={settings}
        from={range.from}
        dates={range.dates}
        initialMealPlans={mealPlans}
        recipes={recipes}
        recipeUsage={recipeUsage}
        allTags={allTags}
        calendarEvents={calendarEvents}
      />
    </AppShell>
  );
}
