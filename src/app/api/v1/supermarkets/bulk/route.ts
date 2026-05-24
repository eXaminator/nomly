import { NextResponse } from "next/server";
import { z } from "zod";

import { errorToResponse } from "@/lib/stammdaten/shared/route-helpers";
import { bulkUpdateSupermarkets } from "@/lib/stammdaten/supermarket/service";

const schema = z
  .object({
    ids: z.array(z.number().int().positive()).min(1).max(500),
    addCategoryIds: z.array(z.number().int().positive()).max(500).optional(),
    removeCategoryIds: z.array(z.number().int().positive()).max(500).optional(),
  })
  .refine(
    (v) =>
      (v.addCategoryIds?.length ?? 0) > 0 ||
      (v.removeCategoryIds?.length ?? 0) > 0,
    { message: "Patch is empty." },
  );

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    const result = bulkUpdateSupermarkets(parsed.data.ids, {
      addCategoryIds: parsed.data.addCategoryIds,
      removeCategoryIds: parsed.data.removeCategoryIds,
    });
    return NextResponse.json(result);
  } catch (e) {
    return errorToResponse(e);
  }
}
