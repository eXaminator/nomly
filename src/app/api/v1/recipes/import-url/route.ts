import { NextResponse } from "next/server";
import { z } from "zod";
import { ImportError, importRecipeFromUrl } from "@/lib/recipe-import";

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
  try {
    const recipe = await importRecipeFromUrl(parsed.data.url);
    return NextResponse.json(recipe);
  } catch (e) {
    if (e instanceof ImportError) {
      const status = e.code === "fetch" ? 502 : 422;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import fehlgeschlagen." },
      { status: 500 },
    );
  }
}
