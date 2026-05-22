import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildIngredientLookup,
  buildUnitLookup,
  parseIngredientLinesIntoSections,
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
    return NextResponse.json({ items: [], sections: [] });
  }

  const lookups = {
    units: buildUnitLookup(),
    ingredients: buildIngredientLookup(),
  };
  const lines = pairTableLines(
    rawLines,
    new Set(lookups.units.byNameOrAlias.keys()),
  );
  const sections = parseIngredientLinesIntoSections(lines, lookups);

  // Backwards-compatible flat list under `items`: the section-editor was
  // wired to expect this shape before section headers existed. The new
  // `sections` field carries the structured response for clients that want
  // to honor section headers ("Für den Teig:" → new section in the editor).
  const items = sections.flatMap((s) => s.ingredients);
  return NextResponse.json({ items, sections });
}
