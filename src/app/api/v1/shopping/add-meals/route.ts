import { NextResponse } from "next/server";
import { z } from "zod";
import { addMealsToList } from "@/lib/shopping/merge";
import { publishShoppingChanged } from "@/lib/shopping/realtime";

const schema = z.object({
  selection: z
    .array(
      z.object({
        mealPlanId: z.number().int().positive(),
        ingredients: z
          .array(
            z.object({
              recipeIngredientId: z.number().int().positive(),
              /**
               * Optional user-edited contribution in the recipe ingredient's
               * unit. When omitted, the scaled recipe quantity is used.
               */
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
  const result = addMealsToList(parsed.data.selection);
  publishShoppingChanged();
  return NextResponse.json(result);
}
