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
  return { title: recipe ? `${recipe.title} kopieren` : "Rezept kopieren" };
}

/**
 * Pre-fills the recipe form with an existing recipe's data but WITHOUT a
 * `recipeId`, so saving creates a fresh recipe rather than updating the
 * original. The title gets a "(Kopie)" suffix.
 */
export default async function CopyRecipePage({
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

  const draft = { ...recipeToDraft(recipe), title: `${recipe.title} (Kopie)` };

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
        <h1 className="text-2xl font-semibold tracking-tight">Rezept kopieren</h1>
        <p className="text-sm text-[var(--color-muted-fg)]">
          Speichern legt ein neues Rezept an – das Original bleibt unverändert.
        </p>
      </div>
      <div className="mt-6">
        {/* No recipeId → RecipeForm POSTs a new recipe on save. */}
        <RecipeForm initial={draft} tagSuggestions={tagSuggestions} />
      </div>
    </>
  );
}
