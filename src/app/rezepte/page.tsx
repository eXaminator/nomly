import Link from "next/link";
import { asc } from "drizzle-orm";
import { Download, Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { DietFilter } from "@/components/recipes/diet-filter";
import { RecipeGrid } from "@/components/recipes/recipe-grid";
import { RecipeSearch } from "@/components/recipes/recipe-search";
import { TagFilterBar } from "@/components/recipes/tag-filter-bar";
import { listRecipes } from "@/lib/recipes/service";
import { db } from "@/db";
import { tag } from "@/db/schema";

export const dynamic = "force-dynamic";

type Search = {
  q?: string;
  must?: string;
  not?: string;
  diet?: string;
};

function parseTagList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseDiet(raw: string | undefined): "vegetarian" | "vegan" | undefined {
  if (raw === "vegan") return "vegan";
  if (raw === "vegetarian") return "vegetarian";
  return undefined;
}

export default async function RezeptePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { q, must, not, diet } = await searchParams;
  const mustTags = parseTagList(must);
  const notTags = parseTagList(not);
  const dietFilter = parseDiet(diet);

  const filteredRecipes = listRecipes({
    query: q,
    mustTags,
    notTags,
    diet: dietFilter,
  });
  const totalUnfiltered = listRecipes().length;
  const filtersActive = Boolean(
    q?.trim().length || mustTags.length || notTags.length || dietFilter,
  );

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

      <div className="mt-4">
        <DietFilter />
      </div>

      {allTags.length > 0 ? (
        <div className="mt-4">
          <TagFilterBar allTags={allTags} />
        </div>
      ) : null}

      <RecipeGrid
        recipes={filteredRecipes}
        totalUnfiltered={totalUnfiltered}
        filtersActive={filtersActive}
      />
    </AppShell>
  );
}
