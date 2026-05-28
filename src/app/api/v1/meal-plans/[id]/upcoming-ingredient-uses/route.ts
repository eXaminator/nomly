import { NextResponse } from "next/server";
import { getUpcomingIngredientUses } from "@/lib/meal-plans/upcoming-uses";

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const result = getUpcomingIngredientUses(id);
  if (!result.ok) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(result.data);
}
