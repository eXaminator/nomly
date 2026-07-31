import { NextResponse } from "next/server";
import { z } from "zod";
import { addDueSoonToList } from "@/lib/shopping/due-soon";
import { publishShoppingChanged } from "@/lib/shopping/realtime";

const schema = z.object({
  ingredientIds: z.array(z.number().int().positive()).min(1),
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
  const result = addDueSoonToList(parsed.data.ingredientIds);
  publishShoppingChanged();
  return NextResponse.json(result, { status: 201 });
}
