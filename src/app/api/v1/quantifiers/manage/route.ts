import { NextResponse } from "next/server";
import { z } from "zod";

import { errorToResponse } from "@/lib/stammdaten/shared/route-helpers";
import {
  createQuantifier,
  listQuantifiersManaged,
} from "@/lib/stammdaten/quantifier/service";
import { publishShoppingChanged } from "@/lib/shopping/realtime";

const upsertSchema = z.object({
  name: z.string().min(1),
  value: z.number().nullable(),
  aliases: z.array(z.string()).default([]),
  sortOrder: z.number().int().optional(),
});

export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json({ items: listQuantifiersManaged(q) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    const result = createQuantifier(parsed.data);
    publishShoppingChanged();
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return errorToResponse(e);
  }
}
