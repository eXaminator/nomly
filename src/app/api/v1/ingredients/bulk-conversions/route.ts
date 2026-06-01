import { NextResponse } from "next/server";
import { z } from "zod";

import { errorToResponse } from "@/lib/stammdaten/shared/route-helpers";
import {
  bulkAddConversion,
  bulkDeleteConversion,
} from "@/lib/stammdaten/ingredient/service";
import { publishShoppingChanged } from "@/lib/shopping/realtime";

const schema = z
  .object({
    fromUnitId: z.number().int().positive(),
    toUnitId: z.number().int().positive(),
    factor: z.number().positive(),
    isContainer: z.boolean().default(false),
    addIds: z.array(z.number().int().positive()).default([]),
    overwriteIds: z.array(z.number().int().positive()).default([]),
  })
  .refine((v) => v.fromUnitId !== v.toUnitId, {
    message: "from and to units must differ",
  })
  .refine((v) => v.addIds.length + v.overwriteIds.length >= 1, {
    message: "no target articles",
  });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    const result = bulkAddConversion(parsed.data);
    // Conversion edges feed the shopping aggregator — tell open clients to
    // refetch so the change shows immediately (matches the single-edit route).
    publishShoppingChanged();
    return NextResponse.json(result);
  } catch (e) {
    return errorToResponse(e);
  }
}

const deleteSchema = z
  .object({
    fromUnitId: z.number().int().positive(),
    toUnitId: z.number().int().positive(),
    ids: z.array(z.number().int().positive()).min(1),
  })
  .refine((v) => v.fromUnitId !== v.toUnitId, {
    message: "from and to units must differ",
  });

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    const result = bulkDeleteConversion(
      parsed.data.fromUnitId,
      parsed.data.toUnitId,
      parsed.data.ids,
    );
    publishShoppingChanged();
    return NextResponse.json(result);
  } catch (e) {
    return errorToResponse(e);
  }
}
