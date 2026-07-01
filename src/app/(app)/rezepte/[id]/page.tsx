import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RecipeDetail } from "@/components/recipes/recipe-detail";
import { getRecipe } from "@/lib/recipes/service";
import { getMealShoppingChoices } from "@/lib/shopping/items";
import { getCurrentUser } from "@/lib/users/current";

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
  const me = await getCurrentUser();
  const recipe = getRecipe(id, me?.id ?? null);
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

  // With a meal in context, load which recipe-ingredient rows this meal put on
  // the shopping list, so the ingredient view can highlight the chosen
  // alternative. Empty when the meal was never added — the view falls back to
  // its default rendering.
  const chosenIngredientIds =
    mealPlanId != null ? getMealShoppingChoices(mealPlanId) : undefined;

  return (
    <RecipeDetail
      recipe={recipe}
      mealPlanId={mealPlanId}
      chosenIngredientIds={chosenIngredientIds}
      showEdit
    />
  );
}
