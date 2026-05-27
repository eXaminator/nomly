import { NextResponse } from "next/server";
import { deleteStapleSource, ShoppingApiError } from "@/lib/shopping/items";
import { publishShoppingChanged } from "@/lib/shopping/realtime";

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Remove a single staple-group contribution from this item. */
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
    const item = deleteStapleSource(itemId, sourceId);
    publishShoppingChanged();
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof ShoppingApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
