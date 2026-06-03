import Link from "next/link";
import { Wrench } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type NeedsUpdateRecipe = {
  id: number;
  title: string;
};

const MAX_VISIBLE = 5;

/**
 * Dashboard card: recipes flagged "needs update" (the wrench toggle). Shows
 * up to {@link MAX_VISIBLE} entries; the rest hide behind the filtered
 * recipe-list link (`?update=1`).
 */
export function NeedsUpdateCard({
  recipes,
  className,
}: {
  recipes: NeedsUpdateRecipe[];
  className?: string;
}) {
  const visible = recipes.slice(0, MAX_VISIBLE);
  const more = recipes.length - visible.length;

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-baseline justify-between">
        <CardTitle className="flex items-center gap-2">
          <Wrench className="size-4 text-[var(--color-muted-fg)]" />
          Zu überarbeiten
        </CardTitle>
        {recipes.length > 0 ? (
          <Link
            href="/rezepte?update=1"
            className="text-sm font-medium text-[var(--color-accent)] hover:underline"
          >
            Alle ansehen →
          </Link>
        ) : null}
      </CardHeader>
      <CardContent>
        {recipes.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">
            Keine Rezepte markiert.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {visible.map((recipe) => (
                <li key={recipe.id}>
                  <Link
                    href={`/rezepte/${recipe.id}`}
                    className="flex min-h-11 items-center truncate rounded-md px-2 -mx-2 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-muted)]/50 hover:underline"
                  >
                    {recipe.title}
                  </Link>
                </li>
              ))}
            </ul>
            {more > 0 ? (
              <p className="mt-2 text-xs text-[var(--color-muted-fg)]">
                + {more} weitere
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
