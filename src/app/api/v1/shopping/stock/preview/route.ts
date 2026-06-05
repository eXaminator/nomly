import { NextResponse } from "next/server";
import { z } from "zod";
import { previewStockCoverage } from "@/lib/shopping/items";

const previewSchema = z
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

/**
 * Dry-run of a stock batch: returns the ids of items whose demand the given
 * "Auf Lager" values would fully cover (they'd be removed on save). Writes
 * nothing — drives the live hint in the stock-check dialog.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const coveredItemIds = previewStockCoverage(parsed.data.entries);
  return NextResponse.json({ coveredItemIds });
}
