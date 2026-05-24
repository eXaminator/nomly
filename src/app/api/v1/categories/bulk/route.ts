import { NextResponse } from "next/server";
import { z } from "zod";

import { errorToResponse } from "@/lib/stammdaten/shared/route-helpers";
import { bulkUpdateCategories } from "@/lib/stammdaten/category/service";

const schema = z
  .object({
    ids: z.array(z.number().int().positive()).min(1).max(500),
    addToSupermarketIds: z
      .array(z.number().int().positive())
      .max(500)
      .optional(),
    removeFromSupermarketIds: z
      .array(z.number().int().positive())
      .max(500)
      .optional(),
  })
  .refine(
    (v) =>
      (v.addToSupermarketIds?.length ?? 0) > 0 ||
      (v.removeFromSupermarketIds?.length ?? 0) > 0,
    { message: "Patch is empty." },
  );

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    const result = bulkUpdateCategories(parsed.data.ids, {
      addToSupermarketIds: parsed.data.addToSupermarketIds,
      removeFromSupermarketIds: parsed.data.removeFromSupermarketIds,
    });
    return NextResponse.json(result);
  } catch (e) {
    return errorToResponse(e);
  }
}
