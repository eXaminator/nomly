import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteMealAndIngredients,
  deleteMealOnly,
} from "@/lib/shopping/meals";

const schema = z.object({ mode: z.enum(["keep", "subtract"]) });

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Shopping-aware meal-removal endpoint. The plain
 * `DELETE /api/v1/meal-plans/[id]` is still wired for the no-shopping case;
 * this endpoint handles the §4.3.3 confirm choices:
 *   - `mode=keep`     → just deletes the meal; cascade trims source rows.
 *                       Existing shopping items keep their quantities.
 *   - `mode=subtract` → recomputes affected item quantities from remaining
 *                       sources; drops items with no surviving sources.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (parsed.data.mode === "keep") {
    deleteMealOnly(id);
    return NextResponse.json({ ok: true, mode: "keep" });
  }
  const result = deleteMealAndIngredients(id);
  return NextResponse.json({ ok: true, mode: "subtract", ...result });
}
