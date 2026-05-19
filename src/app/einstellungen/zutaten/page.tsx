import Link from "next/link";
import { asc } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import {
  IngredientDietList,
  type IngredientDietRow,
} from "@/components/settings/ingredient-diet-list";
import { db } from "@/db";
import { ingredient } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function IngredientDietPage() {
  const rows: IngredientDietRow[] = db
    .select({
      id: ingredient.id,
      name: ingredient.name,
      dietaryClass: ingredient.dietaryClass,
    })
    .from(ingredient)
    .orderBy(asc(ingredient.name))
    .all();

  return (
    <AppShell>
      <div className="flex flex-col gap-2">
        <Link
          href="/einstellungen"
          className="inline-flex w-fit items-center gap-1 text-sm text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]"
        >
          <ChevronLeft className="size-4" />
          Einstellungen
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Zutaten – Diät-Klassifikation
        </h1>
        <p className="text-sm text-[var(--color-muted-fg)]">
          Markiere jede Zutat als <strong>vegan</strong>,{" "}
          <strong>vegetarisch</strong> oder <strong>tierisch</strong>. Daraus
          leitet Nomly ab, ob ein Rezept vegan oder vegetarisch ist. Optionale
          Zutaten beeinflussen das Ergebnis nicht.
        </p>
      </div>
      <div className="mt-6">
        <IngredientDietList initial={rows} />
      </div>
    </AppShell>
  );
}
