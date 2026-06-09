import { NextResponse } from "next/server";

import { errorToResponse } from "@/lib/stammdaten/shared/route-helpers";
import {
  createIngredient,
  listIngredients,
} from "@/lib/stammdaten/ingredient/service";
import { ingredientUpsertSchema } from "@/lib/stammdaten/ingredient/schema";

export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json({ items: listIngredients(q) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = ingredientUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    const created = createIngredient(parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return errorToResponse(e);
  }
}
