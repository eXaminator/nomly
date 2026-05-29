import Link from "next/link";
import { asc } from "drizzle-orm";
import { Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DietFilter } from "@/components/recipes/diet-filter";
import { NeedsUpdateFilter } from "@/components/recipes/needs-update-filter";
import { RecipeGridVirtual } from "@/components/recipes/recipe-grid-virtual";
import { RecipeSearch } from "@/components/recipes/recipe-search";
import { TagFilterBar } from "@/components/recipes/tag-filter-bar";
import { countRecipes, listRecipes } from "@/lib/recipes/service";
import { toListOptions } from "@/lib/recipes/list-query";
import { db } from "@/db";
import { tag } from "@/db/schema";

export const dynamic = "force-dynamic";

// Server-rendered first page: enough to fill the initial viewport with real
// content. The client then fetches the full filtered list and virtualizes it.
const SSR_RECIPE_COUNT = 30;

type Search = {
  q?: string;
  must?: string;
  not?: string;
  diet?: string;
  update?: string;
};

export const metadata = { title: "Rezepte" };

export default async function RezeptePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { q, must, not, diet, update } = await searchParams;
  const matched = listRecipes(toListOptions({ q, must, not, diet, update }));
  const initialRecipes = matched.slice(0, SSR_RECIPE_COUNT);
  const totalUnfiltered = countRecipes();

  const allTags = db
    .select({ name: tag.name })
    .from(tag)
    .orderBy(asc(tag.name))
    .all()
    .map((t) => t.name);

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rezepte</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/rezepte/importieren">
              <Download className="size-4" />
              Importieren
            </Link>
          </Button>
          <Button asChild>
            <Link href="/rezepte/neu">
              <Plus className="size-4" />
              Neues Rezept
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <RecipeSearch />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <DietFilter />
        <NeedsUpdateFilter />
      </div>

      {allTags.length > 0 ? (
        <div className="mt-4">
          <TagFilterBar allTags={allTags} />
        </div>
      ) : null}

      <RecipeGridVirtual
        initialRecipes={initialRecipes}
        initialMatchedCount={matched.length}
        totalUnfiltered={totalUnfiltered}
        filters={{ q, must, not, diet, update }}
      />
    </>
  );
}
