import { asc } from "drizzle-orm";
import { PlannerView } from "@/components/planner/planner-view";
import { db } from "@/db";
import { tag } from "@/db/schema";
import {
  getRecipeUsageStats,
  listByDateRange,
} from "@/lib/meal-plans/service";
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

export const metadata = { title: "Essensplan" };

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
  // The recipe catalog is no longer shipped here — RecipePanel fetches it
  // client-side (see use-recipe-catalog) so /plan's initial payload stays
  // light and the panel can virtualize a large list.
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
    <PlannerView
      today={today}
      settings={settings}
      from={range.from}
      dates={range.dates}
      initialMealPlans={mealPlans}
      recipeUsage={recipeUsage}
      allTags={allTags}
      calendarEvents={calendarEvents}
    />
  );
}
