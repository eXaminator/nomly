import { NextResponse } from "next/server";
import { z } from "zod";
import { addGroupItem, StapleGroupError } from "@/lib/staples/groups";

const schema = z.object({
  ingredientId: z.number().int().positive(),
  quantity: z.number().positive().nullable().optional(),
  unitId: z.number().int().positive().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const groupId = parseId(rawId);
  if (!groupId)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    const result = addGroupItem(groupId, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof StapleGroupError) {
      return NextResponse.json(
        { error: e.code, message: e.message },
        { status: e.status },
      );
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
