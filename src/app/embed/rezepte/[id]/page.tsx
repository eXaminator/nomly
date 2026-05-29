import { notFound } from "next/navigation";
import { RecipeDetail } from "@/components/recipes/recipe-detail";
import { getRecipe } from "@/lib/recipes/service";

export const dynamic = "force-dynamic";

/**
 * Chrome-less recipe view for the Home Assistant iframe. No app nav, no edit
 * button. Auth is the `__nomly_embed` cookie minted by proxy.ts from the `?k=`
 * token; this page never sees the token itself.
 *
 * Query params:
 *   meal=<mealPlanId>  enables the per-ingredient "upcoming uses" affordance
 *                      (where else this ingredient is needed this week).
 *   title=0            hides the recipe-name heading (the HA popup header
 *                      already shows it, so this avoids duplication).
 */
export default async function EmbedRecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ meal?: string; title?: string }>;
}) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const recipe = getRecipe(id);
  if (!recipe) notFound();

  const { meal: rawMeal, title: rawTitle } = await searchParams;
  const mealParam = Number(rawMeal);
  const mealPlanId =
    rawMeal != null && Number.isInteger(mealParam) && mealParam > 0
      ? mealParam
      : null;
  const showTitle = rawTitle !== "0";

  return (
    <main className="min-h-screen bg-[var(--color-bg)]">
      <div className="mx-auto max-w-screen-2xl px-4 py-6 md:px-6">
        <RecipeDetail
          recipe={recipe}
          mealPlanId={mealPlanId}
          showEdit={false}
          showTitle={showTitle}
        />
      </div>
    </main>
  );
}
