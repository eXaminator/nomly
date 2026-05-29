import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { RecipeForm } from "@/components/recipes/recipe-form";
import { getRecipe } from "@/lib/recipes/service";
import { quantityToInputString, type DraftRecipe } from "@/components/recipes/types";
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
    photoUrl: "",
    tags: recipe.tags,
    sections: recipe.sections.map((s) => ({
      uid: crypto.randomUUID(),
      title: s.title ?? "",
      instructions: s.instructions,
      ingredients: s.ingredients.map((i) => ({
        uid: crypto.randomUUID(),
        name: i.ingredientName,
        // "Nicht zugeordnet" line (no article): start with the unassigned
        // pill selected and no canonical/ingredient link.
        canonicalName:
          i.canonicalIngredientName == null ||
          i.canonicalIngredientName.toLowerCase() ===
            i.ingredientName.toLowerCase()
            ? null
            : i.canonicalIngredientName,
        // The row already links to an ingredient (or is unassigned); the pill
        // UI starts with that pill selected. Candidates are populated lazily
        // when the user edits the name (the matcher endpoint runs then).
        selectedIngredientId: i.ingredientId,
        candidates: [],
        addAsAlias: false,
        unassigned: i.ingredientId == null,
        quantity: quantityToInputString(i.quantity),
        // sub_unit_id wins over unit_id (the writer keeps them mutually
        // exclusive). The displayed name comes from the same `unitName`
        // coalesce on the server, so we don't need to look it up twice.
        unit:
          i.subUnitId == null && i.unitId !== null && i.unitName
            ? { id: i.unitId, name: i.unitName }
            : null,
        subUnit:
          i.subUnitId !== null && i.unitName
            ? { id: i.subUnitId, name: i.unitName }
            : null,
        notes: i.notes ?? "",
        isOptional: i.isOptional,
        fixedAmount: i.fixedAmount,
        // The server returns the primary's row id when this row is an
        // alternative. The form only needs the boolean — alternatives sit
        // immediately after their primary in the sorted ingredient array,
        // so the structural relationship is reconstructible client-side.
        isAlternative: i.alternativeForId != null,
        // Reuse the import-flow `rawText` slot — the existing
        // IngredientRow already surfaces it as the "Original" hint.
        rawText: i.rawLine ?? undefined,
      })),
    })),
  };

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
