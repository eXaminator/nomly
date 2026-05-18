import { asc } from "drizzle-orm";
import { AppShell } from "@/components/layout/app-shell";
import { NewRecipeForm } from "@/components/recipes/new-recipe-form";
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
          Erfasse Titel, Zutaten und Anleitung – oder importiere von einer
          Webseite und prüfe das Ergebnis vor dem Speichern.
        </p>
      </div>
      <div className="mt-6">
        <NewRecipeForm tagSuggestions={tagSuggestions} />
      </div>
    </AppShell>
  );
}
