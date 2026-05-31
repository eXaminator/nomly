import { NextResponse } from "next/server";
import { z } from "zod";

import {
  errorToResponse,
  parseId,
} from "@/lib/stammdaten/shared/route-helpers";
import {
  deleteSupermarket,
  getSupermarketDetail,
  updateSupermarket,
} from "@/lib/stammdaten/supermarket/service";
import { publishShoppingChanged } from "@/lib/shopping/realtime";

const updateSchema = z.object({
  name: z.string().min(1),
  orderedCategoryIds: z.array(z.number().int().positive()).default([]),
});

export async function GET(
  _r: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const detail = getSupermarketDetail(id);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  try {
    const result = updateSupermarket(id, parsed.data);
    publishShoppingChanged();
    return NextResponse.json(result);
  } catch (e) {
    return errorToResponse(e);
  }
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const replaceParam = new URL(request.url).searchParams.get("replaceWith");
  const replaceWith = replaceParam ? Number(replaceParam) : undefined;
  if (replaceParam && (!Number.isInteger(replaceWith) || (replaceWith ?? 0) <= 0)) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    const result = deleteSupermarket(id, replaceWith);
    publishShoppingChanged();
    return NextResponse.json(result);
  } catch (e) {
    return errorToResponse(e);
  }
}
