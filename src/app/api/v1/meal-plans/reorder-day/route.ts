import { NextResponse } from "next/server";
import { z } from "zod";
import { reorderDay } from "@/lib/meal-plans/service";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  orderedIds: z.array(z.number().int().positive()),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  reorderDay(parsed.data.date, parsed.data.orderedIds);
  return NextResponse.json({ ok: true });
}
