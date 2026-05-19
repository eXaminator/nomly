import Link from "next/link";
import { asc } from "drizzle-orm";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { RecipeGrid } from "@/components/recipes/recipe-grid";
import { RecipeSearch } from "@/components/recipes/recipe-search";
import { TagFilterBar } from "@/components/recipes/tag-filter-bar";
import { listRecipes } from "@/lib/recipes/service";
import { db } from "@/db";
import { tag } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function RezeptePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  // Tag filtering happens client-side (see RecipeGrid) so chip clicks don't
  // round-trip through the server. Only the text search narrows the SSR set.
  const recipes = listRecipes({ query: q });

  const allTags = db
    .select({ name: tag.name })
    .from(tag)
    .orderBy(asc(tag.name))
    .all()
    .map((t) => t.name);

  return (
    <AppShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rezepte</h1>
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

      {allTags.length > 0 ? (
        <div className="mt-4">
          <TagFilterBar allTags={allTags} />
        </div>
      ) : null}

      <RecipeGrid
        recipes={recipes}
        serverQueryActive={Boolean(q?.trim().length)}
      />
    </AppShell>
  );
}
