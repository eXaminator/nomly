import { NextResponse } from "next/server";
import { z } from "zod";

import { errorToResponse } from "@/lib/stammdaten/shared/route-helpers";
import {
  createIngredient,
  listIngredients,
} from "@/lib/stammdaten/ingredient/service";

const aliasDefaultSchema = z
  .object({
    aliasName: z.string().min(1),
    unitId: z.number().int().positive().nullable().default(null),
    subUnitIndex: z.number().int().nonnegative().nullable().default(null),
  })
  .refine((v) => v.unitId != null || v.subUnitIndex != null, {
    message: "Entweder unitId oder subUnitIndex muss gesetzt sein.",
  });

const subUnitSchema = z.object({
  name: z.string().min(1),
  perPurchase: z.number().positive().default(1),
});

const upsertSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  aliasUnitDefaults: z.array(aliasDefaultSchema).default([]),
  subUnits: z.array(subUnitSchema).default([]),
  defaultCategoryId: z.number().int().positive().nullable(),
  purchaseUnitId: z.number().int().positive().nullable().default(null),
  excludeFromShoppingList: z.boolean(),
  isEquipment: z.boolean().default(false),
  dietaryClass: z.enum(["vegan", "vegetarian", "meat"]).nullable(),
});

export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json({ items: listIngredients(q) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
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
