import { notFound } from "next/navigation";
import { RecipeDetail } from "@/components/recipes/recipe-detail";
import { getRecipe } from "@/lib/recipes/service";

export const dynamic = "force-dynamic";

/**
 * Chrome-less recipe view for the Home Assistant iframe. No app nav, no edit
 * button, and the upcoming-uses affordance off (mealPlanId=null) — read-only by
 * construction, matching the embed token's scope. Auth is the `__nomly_embed`
 * cookie minted by proxy.ts from the `?k=` token; this page never sees the
 * token itself.
 */
export default async function EmbedRecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const recipe = getRecipe(id);
  if (!recipe) notFound();

  return (
    <main className="min-h-screen bg-[var(--color-bg)]">
      <div className="mx-auto max-w-screen-2xl px-4 py-6 md:px-6">
        <RecipeDetail recipe={recipe} mealPlanId={null} showEdit={false} />
      </div>
    </main>
  );
}
