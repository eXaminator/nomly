import { NextResponse } from "next/server";
import { z } from "zod";

import { errorToResponse } from "@/lib/stammdaten/shared/route-helpers";
import {
  createCategory,
  listCategories,
} from "@/lib/stammdaten/category/service";

const upsertSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
});

export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json({ items: listCategories(q) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    return NextResponse.json(createCategory(parsed.data), { status: 201 });
  } catch (e) {
    return errorToResponse(e);
  }
}
