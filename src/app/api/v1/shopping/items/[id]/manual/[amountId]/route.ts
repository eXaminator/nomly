import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteItemAmount,
  setManualAmountQuantity,
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
 * Update the quantity of a specific manual amount row.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; amountId: string }> },
) {
  const { id: rawId, amountId: rawAmount } = await ctx.params;
  const itemId = parseId(rawId);
  const amountId = parseId(rawAmount);
  if (!itemId || !amountId) {
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
    const item = setManualAmountQuantity(
      itemId,
      amountId,
      parsed.data.quantity,
    );
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof ShoppingApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

/** Remove a manual amount row. */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string; amountId: string }> },
) {
  const { id: rawId, amountId: rawAmount } = await ctx.params;
  const itemId = parseId(rawId);
  const amountId = parseId(rawAmount);
  if (!itemId || !amountId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const item = deleteItemAmount(itemId, amountId);
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof ShoppingApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
