import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteItemAmount,
  setItemAmount,
  ShoppingApiError,
} from "@/lib/shopping/items";

const setSchema = z
  .object({
    quantity: z.number().nullable(),
    unitId: z.number().int().positive().nullable(),
  })
  .strict();

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Upsert a manual amount override for one dimension of an item. The
 * dimension is implied by `unitId` (unitless when null). Existing
 * sources for that dimension stay in the database but no longer drive
 * the displayed value — the override wins.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const parsed = setSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const item = setItemAmount(id, parsed.data);
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof ShoppingApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

/**
 * Remove a specific manual override (by amount id) so the dimension falls
 * back to the sources sum.
 */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const url = new URL(request.url);
  const amountId = parseId(url.searchParams.get("amountId") ?? "");
  if (!amountId) {
    return NextResponse.json({ error: "missing amountId" }, { status: 400 });
  }
  try {
    const item = deleteItemAmount(id, amountId);
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof ShoppingApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
