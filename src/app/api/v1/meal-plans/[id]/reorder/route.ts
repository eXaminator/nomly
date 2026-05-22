import { NextResponse } from "next/server";
import { z } from "zod";
import { reorderDown, reorderUp } from "@/lib/meal-plans/service";

const schema = z.object({ direction: z.enum(["up", "down"]) });

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  if (parsed.data.direction === "up") reorderUp(id);
  else reorderDown(id);
  return NextResponse.json({ ok: true });
}
