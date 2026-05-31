import { NextResponse } from "next/server";
import { z } from "zod";
import { setStockBatch } from "@/lib/shopping/items";
import { publishShoppingChanged } from "@/lib/shopping/realtime";

const batchSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            itemId: z.number().int().positive(),
            quantity: z.number().nullable(),
            unitId: z.number().int().positive().nullable(),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict();

/** Apply many "Auf Lager" edits at once (whole-list stock check). */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const items = setStockBatch(parsed.data.entries);
  publishShoppingChanged();
  return NextResponse.json({ items });
}
