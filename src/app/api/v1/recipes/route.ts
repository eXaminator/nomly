import { NextResponse } from "next/server";
import { createRecipe, listRecipes } from "@/lib/recipes/service";
import { recipeInputSchema } from "@/lib/recipes/validate";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  return NextResponse.json({ recipes: listRecipes(q) });
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
  const id = createRecipe(parsed.data);
  return NextResponse.json({ id }, { status: 201 });
}
