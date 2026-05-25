import { NextResponse } from "next/server";
import { z } from "zod";
import { clearAllItems } from "@/lib/shopping/items";
import { clearShoppingListSelective } from "@/lib/shopping/meals";

const schema = z.union([
  z.object({ removeAll: z.literal(true) }),
  z.object({
    removeAll: z.literal(false).optional(),
    mealPlanIds: z.array(z.number().int().positive()).default([]),
    stapleGroupIds: z.array(z.number().int().positive()).default([]),
  }),
]);

/**
 * Selective clear: pick the meals and/or staple groups to drop. Either
 * the convenience { removeAll: true } payload to nuke everything, or
 * explicit lists of meal-plan ids and staple-group ids whose
 * contributions should be subtracted (both run in one transaction).
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
  const data = parsed.data as {
    mealPlanIds: number[];
    stapleGroupIds: number[];
  };
  const result = clearShoppingListSelective({
    mealPlanIds: data.mealPlanIds,
    stapleGroupIds: data.stapleGroupIds,
  });
  return NextResponse.json(result);
}
