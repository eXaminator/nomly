import { NextResponse } from "next/server";
import { z } from "zod";
import { createMeal, listByDateRange } from "@/lib/meal-plans/service";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  recipeId: z.number().int().positive(),
  date: z.string().regex(ISO_DATE),
  servingsOverride: z.number().int().positive().nullable().optional(),
  note: z.string().nullable().optional(),
  isLeftover: z.boolean().optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return NextResponse.json(
      { error: "missing or invalid `from`/`to`" },
      { status: 400 },
    );
  }
  if (from > to) {
    return NextResponse.json({ error: "`from` must be ≤ `to`" }, { status: 400 });
  }
  return NextResponse.json({ mealPlans: listByDateRange(from, to) });
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const id = createMeal(parsed.data);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "create failed" },
      { status: 400 },
    );
  }
}
