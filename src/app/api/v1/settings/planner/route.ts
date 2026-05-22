import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlannerSettings, setPlannerSettings } from "@/lib/settings/planner";

const schema = z
  .object({
    daysVisible: z.number().int().min(1).max(28).optional(),
    startWeekday: z.number().int().min(1).max(7).optional(),
  })
  .strict();

export async function GET() {
  return NextResponse.json(getPlannerSettings());
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const next = setPlannerSettings(parsed.data);
  return NextResponse.json(next);
}
