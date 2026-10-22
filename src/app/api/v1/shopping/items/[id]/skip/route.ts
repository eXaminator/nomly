import { NextResponse } from "next/server";
import { z } from "zod";
import { markSkipped, unmarkSkipped } from "@/lib/shopping/skip";
import { ISO_DATE_RE } from "@/lib/meal-plans/dates";
import { publishShoppingChanged } from "@/lib/shopping/realtime";

/**
 * "Gab es hier heute nicht" for one list entry at one supermarket.
 *
 *   POST   { supermarketId, on: "YYYY-MM-DD" }  → mark (on = device-local day)
 *   DELETE ?supermarketId=N                      → lift the marker
 */

const postSchema = z
  .object({
    supermarketId: z.number().int().positive(),
    on: z.string().regex(ISO_DATE_RE),
  })
  .strict();

const idSchema = z.coerce.number().int().positive();

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const result = markSkipped(id, parsed.data.supermarketId, parsed.data.on);
  if (result === "item-not-found") {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }
  if (result === "store-not-found") {
    return NextResponse.json({ error: "supermarket not found" }, { status: 404 });
  }
  publishShoppingChanged();
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const parsed = idSchema.safeParse(
    new URL(request.url).searchParams.get("supermarketId"),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  unmarkSkipped(id, parsed.data);
  publishShoppingChanged();
  return NextResponse.json({ ok: true });
}
