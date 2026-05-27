import { NextResponse } from "next/server";
import { z } from "zod";
import { addManualItem, ShoppingApiError } from "@/lib/shopping/items";
import { publishShoppingChanged } from "@/lib/shopping/realtime";

const optionalQty = z.number().nullable().optional();
const optionalUnit = z.number().int().positive().nullable().optional();
const optionalNote = z.string().nullable().optional();

const ingredientBody = z.object({
  ingredientId: z.number().int().positive(),
  quantity: optionalQty,
  unitId: optionalUnit,
  note: optionalNote,
});

const newIngredientBody = z.object({
  newIngredient: z.object({
    name: z.string().min(1).max(120),
    defaultCategoryId: z.number().int().positive().nullable().optional(),
  }),
  quantity: optionalQty,
  unitId: optionalUnit,
  note: optionalNote,
});

const byNameBody = z.object({
  byName: z.string().min(1).max(120),
  quantity: optionalQty,
  unitId: optionalUnit,
  note: optionalNote,
});

const schema = z.union([ingredientBody, newIngredientBody, byNameBody]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const result = addManualItem(parsed.data);
    publishShoppingChanged();
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ShoppingApiError) {
      return NextResponse.json(
        { error: err.message, ...(err.payload as object | undefined) },
        { status: err.status },
      );
    }
    throw err;
  }
}
