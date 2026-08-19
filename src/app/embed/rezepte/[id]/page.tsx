import { notFound } from "next/navigation";
import { Soup } from "lucide-react";
import { RecipeDetail } from "@/components/recipes/recipe-detail";
import { getRecipe } from "@/lib/recipes/service";
import { isMealLeftover } from "@/lib/meal-plans/service";
import { getMealShoppingChoices } from "@/lib/shopping/items";

export const dynamic = "force-dynamic";

/**
 * Chrome-less recipe view for the Home Assistant iframe. No app nav, no edit
 * button — but the "Update vormerken" wrench toggle works (the embed
 * allow-list permits that single write). Auth is the `__nomly_embed` cookie
 * minted by proxy.ts from the `?k=` token; this page never sees the token
 * itself.
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
  const leftover = mealPlanId != null && isMealLeftover(mealPlanId);
  // Which rows this meal actually put on the shopping list, so the picked
  // alternative is marked here too — the HA popup is opened straight off a
  // planned meal, so it is exactly where that matters.
  const chosenIngredientIds =
    mealPlanId != null ? getMealShoppingChoices(mealPlanId) : undefined;

  return (
    <main className="min-h-screen bg-[var(--color-bg)]">
      <div className="mx-auto max-w-screen-2xl px-4 py-6 md:px-6">
        {leftover ? (
          // Match RecipeDetail's own `max-w-4xl` content column so the banner
          // lines up with the recipe below it instead of spanning the wider
          // page wrapper.
          <div className="mx-auto mb-4 flex max-w-4xl items-center gap-2 rounded-[var(--radius)] border border-dashed border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2 text-sm text-[var(--color-muted-fg)]">
            <Soup className="size-4 shrink-0" />
            <span>
              <span className="font-medium text-[var(--color-fg)]">Reste</span>{" "}
              — heute gibt es die Reste dieses Gerichts.
            </span>
          </div>
        ) : null}
        <RecipeDetail
          recipe={recipe}
          mealPlanId={mealPlanId}
          chosenIngredientIds={chosenIngredientIds}
          showEdit={false}
          showTitle={showTitle}
        />
      </div>
    </main>
  );
}
