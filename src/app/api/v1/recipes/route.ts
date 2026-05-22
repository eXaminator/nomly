import { NextResponse } from "next/server";
import { createRecipe, listRecipes } from "@/lib/recipes/service";
import { recipeInputSchema } from "@/lib/recipes/validate";
import {
  PhotoUrlError,
  resolvePhotoFromInput,
} from "@/lib/recipes/photo-from-url";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  return NextResponse.json({ recipes: listRecipes({ query: q }) });
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = recipeInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  let resolved;
  try {
    resolved = await resolvePhotoFromInput(parsed.data);
  } catch (e) {
    if (e instanceof PhotoUrlError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    throw e;
  }
  const id = createRecipe(resolved);
  return NextResponse.json({ id }, { status: 201 });
}
