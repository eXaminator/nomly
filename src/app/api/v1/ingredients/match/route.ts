import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildIngredientCatalog,
  buildIngredientLookup,
  buildSubUnitLookup,
  buildUnitLookup,
  parseIngredientLines,
} from "@/lib/recipe-import";

const schema = z.object({ text: z.string().min(1).max(500) });

/**
 * Live ingredient resolution endpoint for the recipe form's pill UI. Takes
 * a freeform ingredient line (e.g. what the user typed into the name field
 * — plus optional quantity / unit / notes — and returns the same ranked
 * candidate matches the importer would produce server-side. Single source
 * of truth for ranking, so the parser and the live UI never disagree.
 *
 * The endpoint reuses `parseIngredientLines` so the typed text gets the
 * same quantity/unit extraction, conjunction splitting, and substring
 * matching the import path runs. Callers that already have a parsed name
 * still send the raw text — re-parsing is cheap and keeps the surface
 * uniform.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  const lookups = {
    units: buildUnitLookup(),
    ingredients: buildIngredientLookup(),
    ingredientCatalog: buildIngredientCatalog(),
    subUnits: buildSubUnitLookup(),
  };
  const results = parseIngredientLines([parsed.data.text], lookups);
  if (results.length === 0) {
    return NextResponse.json({ matches: [], newNameProposals: [] });
  }
  const first = results[0];
  return NextResponse.json({
    matches: first.candidateMatches,
    newNameProposals: first.newNameProposals,
  });
}
