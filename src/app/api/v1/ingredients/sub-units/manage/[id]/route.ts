import { NextResponse } from "next/server";
import { z } from "zod";

import { errorToResponse, parseId } from "@/lib/stammdaten/shared/route-helpers";
import {
  deleteSubUnit,
  updateSubUnit,
} from "@/lib/stammdaten/sub-unit/service";

const updateSchema = z.object({
  name: z.string().min(1),
  plural: z.string().nullable().default(null),
  perPurchase: z.number().positive().default(1),
});

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    return NextResponse.json(updateSubUnit(id, parsed.data));
  } catch (e) {
    return errorToResponse(e);
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    return NextResponse.json(deleteSubUnit(id));
  } catch (e) {
    return errorToResponse(e);
  }
}
