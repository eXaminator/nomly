import { NextResponse } from "next/server";
import { z } from "zod";

import { errorToResponse } from "@/lib/stammdaten/shared/route-helpers";
import {
  createUnit,
  listUnitsManaged,
} from "@/lib/stammdaten/unit/service";

const upsertSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  dimension: z.enum(["mass", "volume", "count"]),
  baseUnitId: z.number().int().positive().nullable(),
  factor: z.number().positive(),
  isContainer: z.boolean().default(false),
});

export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json({ items: listUnitsManaged(q) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    return NextResponse.json(createUnit(parsed.data), { status: 201 });
  } catch (e) {
    return errorToResponse(e);
  }
}
