import { NextResponse } from "next/server";
import { z } from "zod";
import { previewMeals } from "@/lib/shopping/preview";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.object({
  start: z.string().regex(ISO_DATE),
  length: z.number().int().min(1).max(60),
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
  const meals = previewMeals(parsed.data.start, parsed.data.length);
  return NextResponse.json({ meals });
}
