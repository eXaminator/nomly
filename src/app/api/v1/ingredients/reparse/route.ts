import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildIngredientCatalog,
  buildIngredientLookup,
  buildUnitLookup,
  parseIngredientLines,
} from "@/lib/recipe-import";

const schema = z.object({
  lines: z.array(z.string().min(1).max(500)).min(1).max(200),
  /** Optional, parallel to `lines`: alternative source-ranges to fold into
   *  their primary's note instead of emitting as rows (delete-on-reparse). */
  forceFoldRanges: z
    .array(z.array(z.tuple([z.number(), z.number()])))
    .optional(),
});

/**
 * Re-parse a set of original ingredient lines, each INDEPENDENTLY, returning
 * the full parsed rows per line (a single line can expand into a primary +
 * alternatives). Backs the recipe editor's "re-parse" buttons: re-apply the
 * current parser to a row's / recipe's original source lines to pick up
 * parser improvements or revert manual edits.
 *
 * Unlike `/ingredients/parse` (clipboard), this does NO clipboard-splitting
 * or table-pairing — callers already hold clean, individual source lines and
 * want a deterministic one-line-in → row(s)-out mapping, parallel to `lines`.
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
  };
  const results = parsed.data.lines.map((line, i) =>
    parseIngredientLines([line], lookups, {
      forceFoldRanges: parsed.data.forceFoldRanges?.[i],
    }),
  );
  return NextResponse.json({ results });
}
