import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { ingredient, ingredientAlias } from "@/db/schema";

const schema = z.object({
  names: z.array(z.string()).max(200),
});

/**
 * Reports which of the submitted ingredient names would be auto-created on
 * recipe save. A name is "existing" when it matches a canonical ingredient
 * row or any alias (Unicode-aware, case-insensitive). The recipe-form uses
 * this to decide whether to prompt for category / dietary class / exclude
 * flags before posting the recipe.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  const submitted = parsed.data.names
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  if (submitted.length === 0) {
    return NextResponse.json({ newNames: [] });
  }
  const lowered = submitted.map((n) => n.toLowerCase());
  const canonicalHits = db
    .select({ name: sql<string>`lower_u(${ingredient.name})` })
    .from(ingredient)
    .where(inArray(sql`lower_u(${ingredient.name})`, lowered))
    .all();
  const aliasHits = db
    .select({ name: sql<string>`lower_u(${ingredientAlias.name})` })
    .from(ingredientAlias)
    .where(inArray(sql`lower_u(${ingredientAlias.name})`, lowered))
    .all();
  void or;
  void eq;
  const existing = new Set<string>();
  for (const r of canonicalHits) existing.add(r.name);
  for (const r of aliasHits) existing.add(r.name);
  // De-duplicate while preserving original casing + order of first occurrence.
  const seen = new Set<string>();
  const newNames: string[] = [];
  for (const raw of submitted) {
    const key = raw.toLowerCase();
    if (existing.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    newNames.push(raw);
  }
  return NextResponse.json({ newNames });
}
