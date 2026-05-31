import { NextResponse } from "next/server";
import { z } from "zod";
import { clearItemStock, setItemStock, ShoppingApiError } from "@/lib/shopping/items";
import { publishShoppingChanged } from "@/lib/shopping/realtime";

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

/** Set (upsert) the "Auf Lager" amount for an item. */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
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
    const item = setItemStock(id, parsed.data);
    publishShoppingChanged();
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof ShoppingApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

/** Clear the "Auf Lager" amount for an item. */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const item = clearItemStock(id);
    publishShoppingChanged();
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof ShoppingApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
