import { NextResponse } from "next/server";
import { previewDueSoonIngredients, type DueSoonPreview } from "@/lib/shopping/due-soon";
import { getPlannerSettings } from "@/lib/settings/planner";

/**
 * Ingredients predicted to be due within the planner's configured window
 * (`daysVisible` — "die Anzahl der Tage die auch im Essensplan eingestellt
 * ist"), based on recorded buying cadence.
 */
export async function GET() {
  const { daysVisible } = getPlannerSettings();
  const items = previewDueSoonIngredients(daysVisible);
  const payload: DueSoonPreview = { withinDays: daysVisible, items };
  return NextResponse.json(payload);
}
