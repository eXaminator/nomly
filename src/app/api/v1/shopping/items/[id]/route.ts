import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteItem, patchItem, ShoppingApiError } from "@/lib/shopping/items";
import {
  recallMutation,
  recordMutation,
} from "@/lib/shopping/offline/mutation-dedup";
import { publishShoppingChanged } from "@/lib/shopping/realtime";

const patchSchema = z
  .object({
    checked: z.boolean().optional(),
    note: z.string().nullable().optional(),
    mutationId: z.string().uuid().optional(),
  })
  .strict();

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { mutationId, ...patch } = parsed.data;
  if (mutationId) {
    const cached = recallMutation<{ item: unknown }>(mutationId);
    if (cached) return NextResponse.json(cached);
  }
  try {
    const item = patchItem(id, patch);
    const payload = { item };
    if (mutationId) recordMutation(mutationId, payload);
    publishShoppingChanged();
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof ShoppingApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    deleteItem(id);
    publishShoppingChanged();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ShoppingApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
