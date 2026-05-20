import { NextResponse } from "next/server";
import { z } from "zod";

import { errorToResponse } from "@/lib/stammdaten/shared/route-helpers";
import { createTag, listTags } from "@/lib/stammdaten/tag/service";

const upsertSchema = z.object({ name: z.string().min(1) });

export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json({ items: listTags(q) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  try {
    return NextResponse.json(createTag(parsed.data), { status: 201 });
  } catch (e) {
    return errorToResponse(e);
  }
}
