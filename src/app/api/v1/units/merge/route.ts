import { NextResponse } from "next/server";
import { z } from "zod";

import { errorToResponse } from "@/lib/stammdaten/shared/route-helpers";
import { mergeUnits } from "@/lib/stammdaten/unit/service";
import { publishShoppingChanged } from "@/lib/shopping/realtime";

const mergeSchema = z.object({
  winnerId: z.number().int().positive(),
  loserIds: z.array(z.number().int().positive()).min(1),
  replaceIds: z.array(z.number().int().positive()).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = mergeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  try {
    const result = mergeUnits(parsed.data.winnerId, parsed.data.loserIds, {
      replaceIds: parsed.data.replaceIds,
    });
    publishShoppingChanged();
    return NextResponse.json(result);
  } catch (e) {
    return errorToResponse(e);
  }
}
