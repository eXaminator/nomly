import { NextResponse } from "next/server";
import { duplicateMealToNextDay } from "@/lib/meal-plans/service";

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Duplicate a meal onto the next day as a leftover ("we'll eat this again
 * tomorrow"). Returns the new meal id.
 */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const newId = duplicateMealToNextDay(id);
    return NextResponse.json({ id: newId }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "duplicate failed" },
      { status: 400 },
    );
  }
}
