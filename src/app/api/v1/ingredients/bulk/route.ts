import { NextResponse } from "next/server";
import { z } from "zod";

import { errorToResponse } from "@/lib/stammdaten/shared/route-helpers";
import { bulkUpdateIngredients } from "@/lib/stammdaten/ingredient/service";

const schema = z
  .object({
    ids: z.array(z.number().int().positive()).min(1).max(500),
    patch: z.object({
      defaultCategoryId: z.number().int().positive().nullable().optional(),
      dietaryClass: z.enum(["vegan", "vegetarian", "meat"]).nullable().optional(),
      excludeFromShoppingList: z.boolean().optional(),
    }),
  })
  .refine(
    (v) =>
      v.patch.defaultCategoryId !== undefined ||
      v.patch.dietaryClass !== undefined ||
      v.patch.excludeFromShoppingList !== undefined,
    { message: "Patch is empty." },
  );

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    const result = bulkUpdateIngredients(parsed.data.ids, parsed.data.patch);
    return NextResponse.json(result);
  } catch (e) {
    return errorToResponse(e);
  }
}
