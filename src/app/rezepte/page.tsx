import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { RecipeCard } from "@/components/recipes/recipe-card";
import { RecipeSearch } from "@/components/recipes/recipe-search";
import { listRecipes } from "@/lib/recipes/service";

export const dynamic = "force-dynamic";

export default async function RezeptePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const recipes = listRecipes(q);

  return (
    <AppShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rezepte</h1>
          <p className="text-sm text-[var(--color-muted-fg)]">
            {recipes.length === 0
              ? q
                ? `Keine Treffer für „${q}".`
                : "Noch keine Rezepte – jetzt das erste anlegen."
              : `${recipes.length} Rezept${recipes.length === 1 ? "" : "e"}.`}
          </p>
        </div>
        <Button asChild>
          <Link href="/rezepte/neu">
            <Plus className="size-4" />
            Neues Rezept
          </Link>
        </Button>
      </div>

      <div className="mt-6">
        <RecipeSearch />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {recipes.map((r) => (
          <RecipeCard key={r.id} recipe={r} />
        ))}
      </div>
    </AppShell>
  );
}
