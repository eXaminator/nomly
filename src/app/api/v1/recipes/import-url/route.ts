import { NextResponse } from "next/server";
import { z } from "zod";
import { ImportError, importRecipeFromUrl } from "@/lib/recipe-import";
import { recordImportFailure } from "@/lib/recipes/import-failures";

const schema = z.object({
  url: z.string().url(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige URL." },
      { status: 400 },
    );
  }
  const url = parsed.data.url;
  try {
    // A success leaves a failed-list entry in place: it is cleared when the
    // imported recipe is saved (POST /api/v1/recipes), so a discarded draft
    // keeps the URL on the list.
    const recipe = await importRecipeFromUrl(url);
    return NextResponse.json(recipe);
  } catch (e) {
    if (e instanceof ImportError) {
      recordImportFailure(url, e.code, e.message);
      const status = e.code === "fetch" ? 502 : 422;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    const message = e instanceof Error ? e.message : "Import fehlgeschlagen.";
    recordImportFailure(url, "unknown", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
