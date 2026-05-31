import { NextResponse } from "next/server";
import { z } from "zod";

import { errorToResponse } from "@/lib/stammdaten/shared/route-helpers";
import {
  createIngredient,
  listIngredients,
} from "@/lib/stammdaten/ingredient/service";

const aliasDefaultSchema = z.object({
  aliasName: z.string().min(1),
  unitId: z.number().int().positive().nullable().default(null),
});

const conversionSchema = z.object({
  fromUnitId: z.number().int().positive(),
  toUnitId: z.number().int().positive(),
  factor: z.number().positive(),
  isContainer: z.boolean().default(false),
});

const upsertSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  aliasUnitDefaults: z.array(aliasDefaultSchema).default([]),
  aliasDisplayNames: z.record(z.string(), z.string()).default({}),
  conversions: z.array(conversionSchema).default([]),
  defaultUnitId: z.number().int().positive().nullable().default(null),
  defaultCategoryId: z.number().int().positive().nullable(),
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
