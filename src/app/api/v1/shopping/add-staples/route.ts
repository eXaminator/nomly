import { NextResponse } from "next/server";
import { z } from "zod";
import { addStapleSelectionToList } from "@/lib/staples/apply";
import { publishShoppingChanged } from "@/lib/shopping/realtime";

const schema = z.object({
  selection: z
    .array(
      z.object({
        stapleGroupId: z.number().int().positive(),
        items: z
          .array(
            z.object({
              stapleGroupItemId: z.number().int().positive(),
              /** Optional per-item quantity override in the item's unit. */
              quantity: z.number().nullable().optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const result = addStapleSelectionToList(parsed.data.selection);
  publishShoppingChanged();
  return NextResponse.json(result, { status: 201 });
}
