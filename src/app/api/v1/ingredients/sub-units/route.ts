import { NextResponse } from "next/server";
import { z } from "zod";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredient,
  ingredientAlias,
  ingredientSubUnit,
} from "@/db/schema";

const schema = z.object({ name: z.string().min(1) });

/**
 * Resolve an ingredient name (canonical OR alias) to the ingredient's
 * sub-units. Used by the recipe form's unit picker to surface the typed
 * row's available sub-units alongside global units.
 *
 * Returns `{ ingredientId: null, subUnits: [] }` when the name doesn't
 * match any existing ingredient — manually-entered new ingredients have no
 * sub-units yet.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  const cleaned = parsed.data.name.trim();
  if (cleaned.length === 0) {
    return NextResponse.json({ ingredientId: null, subUnits: [] });
  }
  const lowered = cleaned.toLowerCase();
  const canonical = db
    .select({ id: ingredient.id })
    .from(ingredient)
    .where(sql`lower_u(${ingredient.name}) = ${lowered}`)
    .get();
  let ingredientId = canonical?.id ?? null;
  if (ingredientId == null) {
    const aliased = db
      .select({ id: ingredient.id })
      .from(ingredientAlias)
      .innerJoin(ingredient, eq(ingredient.id, ingredientAlias.ingredientId))
      .where(sql`lower_u(${ingredientAlias.name}) = ${lowered}`)
      .get();
    ingredientId = aliased?.id ?? null;
  }
  if (ingredientId == null) {
    return NextResponse.json({ ingredientId: null, subUnits: [] });
  }
  const subUnits = db
    .select({
      id: ingredientSubUnit.id,
      name: ingredientSubUnit.name,
      perPurchase: ingredientSubUnit.perPurchase,
    })
    .from(ingredientSubUnit)
    .where(inArray(ingredientSubUnit.ingredientId, [ingredientId]))
    .orderBy(asc(ingredientSubUnit.name))
    .all();
  return NextResponse.json({ ingredientId, subUnits });
}
