import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { asc } from "drizzle-orm";
import { AppShell } from "@/components/layout/app-shell";
import { ImportFlow } from "@/components/recipes/import-flow";
import { db } from "@/db";
import { tag } from "@/db/schema";

export const dynamic = "force-dynamic";

export default function ImportRecipePage() {
  const tagSuggestions = db
    .select({ name: tag.name })
    .from(tag)
    .orderBy(asc(tag.name))
    .all()
    .map((t) => t.name);

  return (
    <AppShell>
      <div className="flex flex-col gap-2">
        <Link
          href="/rezepte"
          className="inline-flex w-fit items-center gap-1 text-sm text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]"
        >
          <ChevronLeft className="size-4" />
          Rezepte
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Rezept importieren
        </h1>
        <p className="text-sm text-[var(--color-muted-fg)]">
          Importiere ein Rezept von einer Webseite mit strukturierten
          Rezeptdaten. Anschließend kannst du alles prüfen und korrigieren –
          neue Zutaten oder unbekannte Einheiten sind markiert.
        </p>
      </div>
      <div className="mt-6">
        <ImportFlow tagSuggestions={tagSuggestions} />
      </div>
    </AppShell>
  );
}
