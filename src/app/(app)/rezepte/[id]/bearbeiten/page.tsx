import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { RecipeForm } from "@/components/recipes/recipe-form";
import { getRecipe } from "@/lib/recipes/service";
import { recipeToDraft } from "@/components/recipes/types";
import { db } from "@/db";
import { tag } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: rawId } = await params;
  const id = Number(rawId);
  const recipe = Number.isInteger(id) && id > 0 ? getRecipe(id) : null;
  return { title: recipe ? `${recipe.title} bearbeiten` : "Rezept bearbeiten" };
}

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

  const draft = recipeToDraft(recipe);

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link
          href={`/rezepte/${id}`}
          className="inline-flex w-fit items-center gap-1 text-sm text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]"
        >
          <ChevronLeft className="size-4" />
          {recipe.title}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Rezept bearbeiten</h1>
      </div>
      <div className="mt-6">
        <RecipeForm initial={draft} recipeId={id} tagSuggestions={tagSuggestions} />
      </div>
    </>
  );
}
