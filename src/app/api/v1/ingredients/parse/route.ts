import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildIngredientLookup,
  buildUnitLookup,
  parseIngredientLines,
  type ImportedIngredient,
} from "@/lib/recipe-import";
import {
  pairTableLines,
  splitClipboardToLines,
} from "@/lib/recipe-import/pair-lines";

const schema = z.object({ text: z.string().min(1).max(20_000) });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }

  const rawLines = splitClipboardToLines(parsed.data.text);
  if (rawLines.length === 0) {
    return NextResponse.json({ items: [] as ImportedIngredient[] });
  }

  const lookups = {
    units: buildUnitLookup(),
    ingredients: buildIngredientLookup(),
  };
  const lines = pairTableLines(
    rawLines,
    new Set(lookups.units.byNameOrAlias.keys()),
  );
  const items = parseIngredientLines(lines, lookups);
  return NextResponse.json({ items });
}
