import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RecipeDetail } from "@/components/recipes/recipe-detail";
import { getRecipe } from "@/lib/recipes/service";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: rawId } = await params;
  const id = Number(rawId);
  const recipe = Number.isInteger(id) && id > 0 ? getRecipe(id) : null;
  // Fall back to the bare default when the recipe is missing (the page itself
  // renders notFound()).
  return recipe ? { title: recipe.title } : {};
}

export default async function RecipeViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ meal?: string }>;
}) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const recipe = getRecipe(id);
  if (!recipe) notFound();

  // Optional meal-context query param. When set, the recipe view enables
  // the per-ingredient "upcoming uses" affordance, which only makes sense
  // when "future" has a concrete anchor (the meal's date).
  const { meal: rawMeal } = await searchParams;
  const mealParam = Number(rawMeal);
  const mealPlanId =
    rawMeal != null && Number.isInteger(mealParam) && mealParam > 0
      ? mealParam
      : null;

  return <RecipeDetail recipe={recipe} mealPlanId={mealPlanId} showEdit />;
}
