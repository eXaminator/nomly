import { NextResponse } from "next/server";
import { getIngredientUsageByName } from "@/lib/ingredients/usage";

/**
 * GET /api/v1/ingredients/usage?name=<text>
 * "Do we need <name> for anything else?" — resolves the name and reports the
 * upcoming meals using it plus whether it's on the shopping list.
 */
export function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name");
  if (!name || name.trim().length === 0) {
    return NextResponse.json({ error: "missing `name`" }, { status: 400 });
  }
  return NextResponse.json(getIngredientUsageByName(name));
}
