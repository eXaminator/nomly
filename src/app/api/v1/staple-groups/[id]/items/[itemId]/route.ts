import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteGroupItem,
  StapleGroupError,
  updateGroupItem,
} from "@/lib/staples/groups";

const patchSchema = z
  .object({
    quantity: z.number().positive().nullable().optional(),
    unitId: z.number().int().positive().nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .strict();

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  const params = await ctx.params;
  const itemId = parseId(params.itemId);
  if (!itemId)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    updateGroupItem(itemId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorToResponse(e);
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  const params = await ctx.params;
  const itemId = parseId(params.itemId);
  if (!itemId)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    deleteGroupItem(itemId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorToResponse(e);
  }
}

function errorToResponse(e: unknown): NextResponse {
  if (e instanceof StapleGroupError) {
    return NextResponse.json(
      { error: e.code, message: e.message },
      { status: e.status },
    );
  }
  return NextResponse.json({ error: "internal" }, { status: 500 });
}
