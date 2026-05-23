import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteSource,
  setSourceQuantity,
  ShoppingApiError,
} from "@/lib/shopping/items";

const schema = z
  .object({
    quantity: z.number().nullable(),
  })
  .strict();

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Update a single recipe-derived source row's contributed quantity. The
 * row editor uses this so the user can adjust one meal's contribution
 * without scaling the whole dimension's other sources.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; sourceId: string }> },
) {
  const { id: rawId, sourceId: rawSource } = await ctx.params;
  const itemId = parseId(rawId);
  const sourceId = parseId(rawSource);
  if (!itemId || !sourceId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const item = setSourceQuantity(itemId, sourceId, parsed.data.quantity);
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof ShoppingApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

/** Remove a single recipe-source contribution from this item. */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string; sourceId: string }> },
) {
  const { id: rawId, sourceId: rawSource } = await ctx.params;
  const itemId = parseId(rawId);
  const sourceId = parseId(rawSource);
  if (!itemId || !sourceId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const item = deleteSource(itemId, sourceId);
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof ShoppingApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
