import { RecipeCard } from "./recipe-card";
import type { RecipeListItem } from "@/lib/recipes/types";

type Props = {
  recipes: RecipeListItem[];
  totalUnfiltered: number;
  filtersActive: boolean;
};

export function RecipeGrid({ recipes, totalUnfiltered, filtersActive }: Props) {
  const shown = recipes.length;
  const someFilteredOut = shown < totalUnfiltered;
  return (
    <>
      <p className="mt-2 text-sm text-[var(--color-muted-fg)]">
        {shown === 0
          ? filtersActive
            ? "Keine Treffer mit den aktuellen Filtern."
            : "Noch keine Rezepte – jetzt das erste anlegen."
          : someFilteredOut
            ? `${shown} von ${totalUnfiltered} Rezepten.`
            : `${shown} Rezept${shown === 1 ? "" : "e"}.`}
      </p>
      <div className="mt-6 grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {recipes.map((r) => (
          <RecipeCard key={r.id} recipe={r} />
        ))}
      </div>
    </>
  );
}
