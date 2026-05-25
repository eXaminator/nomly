import { NextResponse } from "next/server";
import { z } from "zod";
import { clearAllItems } from "@/lib/shopping/items";
import { clearShoppingListSelective } from "@/lib/shopping/meals";

const schema = z.union([
  z.object({ removeAll: z.literal(true) }),
  z.object({
    removeAll: z.literal(false).optional(),
    mealPlanIds: z.array(z.number().int().positive()).default([]),
  }),
]);

/**
 * Selective clear: pick the meals to drop. Either the convenience
 * { removeAll: true } payload to nuke everything, or an explicit list of
 * meal plan ids whose contributions should be subtracted.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if ("removeAll" in parsed.data && parsed.data.removeAll === true) {
    const result = clearAllItems();
    return NextResponse.json({ deletedCount: result.deletedCount });
  }
  const data = parsed.data as { mealPlanIds: number[] };
  const result = clearShoppingListSelective({ mealPlanIds: data.mealPlanIds });
  return NextResponse.json(result);
}
