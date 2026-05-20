import { NextResponse } from "next/server";
import { z } from "zod";

import { errorToResponse } from "@/lib/stammdaten/shared/route-helpers";
import { mergeIngredients } from "@/lib/stammdaten/ingredient/service";

const mergeSchema = z.object({
  winnerId: z.number().int().positive(),
  loserIds: z.array(z.number().int().positive()).min(1),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = mergeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      mergeIngredients(parsed.data.winnerId, parsed.data.loserIds),
    );
  } catch (e) {
    return errorToResponse(e);
  }
}
