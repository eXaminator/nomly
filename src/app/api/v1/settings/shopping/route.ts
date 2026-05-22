import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getShoppingSettings,
  setShoppingSettings,
} from "@/lib/shopping/settings";

const schema = z
  .object({
    defaultLengthDays: z.number().int().min(1).max(60).optional(),
  })
  .strict();

export async function GET() {
  return NextResponse.json(getShoppingSettings());
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const next = setShoppingSettings(parsed.data);
  return NextResponse.json(next);
}
