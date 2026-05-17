import { asc } from "drizzle-orm";
import { AppShell } from "@/components/layout/app-shell";
import { RecipeForm } from "@/components/recipes/recipe-form";
import { db } from "@/db";
import { tag } from "@/db/schema";

export const dynamic = "force-dynamic";

export default function NewRecipePage() {
  const tagSuggestions = db
    .select({ name: tag.name })
    .from(tag)
    .orderBy(asc(tag.name))
    .all()
    .map((t) => t.name);

  return (
    <AppShell>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Neues Rezept</h1>
        <p className="text-sm text-[var(--color-muted-fg)]">
          Erfasse Titel, Zutaten und Anleitung. Du kannst alles später bearbeiten.
        </p>
      </div>
      <div className="mt-6">
        <RecipeForm tagSuggestions={tagSuggestions} />
      </div>
    </AppShell>
  );
}
