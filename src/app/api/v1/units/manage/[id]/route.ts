import { NextResponse } from "next/server";
import { z } from "zod";

import {
  errorToResponse,
  parseId,
} from "@/lib/stammdaten/shared/route-helpers";
import {
  deleteUnit,
  getUnitDetail,
  updateUnit,
} from "@/lib/stammdaten/unit/service";

const updateSchema = z.object({
  name: z.string().min(1),
  plural: z.string().nullable().default(null),
  aliases: z.array(z.string()).default([]),
  aliasPlurals: z.record(z.string(), z.string()).default({}),
  dimension: z.enum(["mass", "volume", "count"]),
  baseUnitId: z.number().int().positive().nullable(),
  factor: z.number().positive(),
  isContainer: z.boolean().default(false),
});

export async function GET(
  _r: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const detail = getUnitDetail(id);
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
    return NextResponse.json(updateUnit(id, parsed.data));
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
    return NextResponse.json(deleteUnit(id, replaceWith));
  } catch (e) {
    return errorToResponse(e);
  }
}
