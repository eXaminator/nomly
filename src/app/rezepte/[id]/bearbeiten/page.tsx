import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { AppShell } from "@/components/layout/app-shell";
import { RecipeForm } from "@/components/recipes/recipe-form";
import { getRecipe } from "@/lib/recipes/service";
import type { DraftRecipe } from "@/components/recipes/types";
import { db } from "@/db";
import { tag } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function EditRecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const recipe = getRecipe(id);
  if (!recipe) notFound();

  const tagSuggestions = db
    .select({ name: tag.name })
    .from(tag)
    .orderBy(asc(tag.name))
    .all()
    .map((t) => t.name);

  const draft: DraftRecipe = {
    title: recipe.title,
    description: recipe.description ?? "",
    servings: String(recipe.servings),
    prepTimeMin: recipe.prepTimeMin === null ? "" : String(recipe.prepTimeMin),
    cookTimeMin: recipe.cookTimeMin === null ? "" : String(recipe.cookTimeMin),
    sourceUrl: recipe.sourceUrl ?? "",
    photoPath: recipe.photoPath,
    tags: recipe.tags,
    sections: recipe.sections.map((s) => ({
      uid: crypto.randomUUID(),
      title: s.title ?? "",
      instructions: s.instructions,
      ingredients: s.ingredients.map((i) => ({
        uid: crypto.randomUUID(),
        name: i.ingredientName,
        quantity: i.quantity === null ? "" : String(i.quantity),
        unit: i.unitId !== null && i.unitName ? { id: i.unitId, name: i.unitName } : null,
        notes: i.notes ?? "",
      })),
    })),
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Rezept bearbeiten</h1>
        <p className="text-sm text-[var(--color-muted-fg)]">{recipe.title}</p>
      </div>
      <div className="mt-6">
        <RecipeForm initial={draft} recipeId={id} tagSuggestions={tagSuggestions} />
      </div>
    </AppShell>
  );
}
