import { NextResponse } from "next/server";
import { z } from "zod";

import {
  errorToResponse,
  parseId,
} from "@/lib/stammdaten/shared/route-helpers";
import {
  deleteIngredient,
  getIngredientDetail,
  updateIngredient,
} from "@/lib/stammdaten/ingredient/service";

const aliasDefaultSchema = z.object({
  aliasName: z.string().min(1),
  unitId: z.number().int().positive().nullable().default(null),
});

const conversionSchema = z.object({
  fromUnitId: z.number().int().positive(),
  toUnitId: z.number().int().positive(),
  factor: z.number().positive(),
  isContainer: z.boolean().default(false),
});

const updateSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  aliasUnitDefaults: z.array(aliasDefaultSchema).default([]),
  aliasDisplayNames: z.record(z.string(), z.string()).default({}),
  conversions: z.array(conversionSchema).default([]),
  defaultUnitId: z.number().int().positive().nullable().default(null),
  defaultCategoryId: z.number().int().positive().nullable(),
  excludeFromShoppingList: z.boolean(),
  dietaryClass: z.enum(["vegan", "vegetarian", "meat"]).nullable(),
  // Optional propagation rider: rewrite exact display_name matches on this
  // ingredient's existing recipe rows when a name/alias was renamed.
  renamePairs: z
    .array(z.object({ from: z.string().min(1), to: z.string().min(1) }))
    .default([]),
  propagateRenames: z.boolean().default(false),
});

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const detail = getIngredientDetail(id);
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
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  const { renamePairs, propagateRenames, ...upsert } = parsed.data;
  try {
    return NextResponse.json(
      updateIngredient(id, upsert, propagateRenames ? renamePairs : []),
    );
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
    return NextResponse.json(deleteIngredient(id, replaceWith));
  } catch (e) {
    return errorToResponse(e);
  }
}
