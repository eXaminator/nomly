import { NextResponse } from "next/server";
import { createRecipe, listRecipes } from "@/lib/recipes/service";
import { toListOptions } from "@/lib/recipes/list-query";
import { getCurrentUser } from "@/lib/users/current";
import type { PlannerRecipe } from "@/lib/recipes/types";
import { recipeInputSchema } from "@/lib/recipes/validate";
import {
  PhotoUrlError,
  resolvePhotoFromInput,
} from "@/lib/recipes/photo-from-url";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const me = await getCurrentUser();
  const recipes = listRecipes(
    toListOptions(
      {
        q: sp.get("q"),
        must: sp.get("must"),
        not: sp.get("not"),
        diet: sp.get("diet"),
        update: sp.get("update"),
        fav: sp.get("fav"),
      },
      me?.id,
    ),
  );
  // `fields=light` returns the PlannerRecipe subset — the meal planner only
  // renders title/photo/tags/diet and seeds portions from `servings`, so it
  // never needs the description or prep/cook times.
  if (sp.get("fields") === "light") {
    const light: PlannerRecipe[] = recipes.map((r) => ({
      id: r.id,
      title: r.title,
      photoPath: r.photoPath,
      servings: r.servings,
      tags: r.tags,
      isVegan: r.isVegan,
      isVegetarian: r.isVegetarian,
      dietConfidence: r.dietConfidence,
    }));
    return NextResponse.json({ recipes: light });
  }
  return NextResponse.json({ recipes });
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
