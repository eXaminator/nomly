import Link from "next/link";
import { asc } from "drizzle-orm";
import { ChevronLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <>
      <Link
        href="/rezepte"
        className="inline-flex w-fit items-center gap-1 text-sm text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]"
      >
        <ChevronLeft className="size-4" />
        Rezepte
      </Link>
      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Neues Rezept</h1>
          <p className="text-sm text-[var(--color-muted-fg)]">
            Erfasse Titel, Zutaten und Anleitung. Du kannst alles später bearbeiten.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/rezepte/importieren">
            <Download className="size-4" />
            Aus URL importieren
          </Link>
        </Button>
      </div>
      <div className="mt-6">
        <NewRecipeForm tagSuggestions={tagSuggestions} />
      </div>
    </>
  );
}
