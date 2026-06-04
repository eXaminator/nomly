import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OfflineAwareLink } from "./offline-aware-link";
import type { MostEatenRecipe } from "@/lib/meal-plans/service";

/**
 * Dashboard card: the most-cooked recipes from the meal-plan history
 * (leftover days don't count). Empty until some history accumulates.
 */
export function TopRecipesCard({
  recipes,
  className,
}: {
  recipes: MostEatenRecipe[];
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Am häufigsten gekocht</CardTitle>
      </CardHeader>
      <CardContent>
        {recipes.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">
            Noch keine Historie — plane ein paar Mahlzeiten.
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {recipes.map((recipe, i) => (
              <li key={recipe.recipeId}>
                <OfflineAwareLink
                  href={`/rezepte/${recipe.recipeId}`}
                  className="group flex min-h-11 items-center gap-2.5 rounded-md px-2 -mx-2 hover:bg-[var(--color-muted)]/50"
                >
                  <span className="w-4 shrink-0 text-right text-sm tabular-nums text-[var(--color-muted-fg)]">
                    {i + 1}.
                  </span>
                  {recipe.photoPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/v1/${recipe.photoPath}`}
                      alt=""
                      className="size-9 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="size-9 shrink-0 rounded bg-[var(--color-muted)]" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-fg)] group-hover:underline">
                    {recipe.title}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--color-muted-fg)]">
                    {recipe.count}×
                  </span>
                </OfflineAwareLink>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
