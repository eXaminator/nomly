import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { TodayMealShoppingStatus } from "@/lib/shopping/today-meal-shopping";

/**
 * Amber banner at the top of the dashboard when today's meals still have
 * unchecked items on the shopping list — the on-page twin of the Home
 * Assistant morning reminder. Renders nothing when there's nothing to buy.
 */
export function TodayShoppingWarning({
  status,
}: {
  status: TodayMealShoppingStatus;
}) {
  if (!status.needsShopping) return null;

  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-warning)] bg-[color-mix(in_srgb,var(--color-warning),transparent_92%)] p-4">
      <div className="flex items-center gap-2 font-medium text-[var(--color-fg)]">
        <TriangleAlert className="size-5 shrink-0 text-[var(--color-warning)]" />
        Für heute {status.totalUncheckedItems === 1 ? "fehlt" : "fehlen"} noch{" "}
        {status.totalUncheckedItems} Artikel auf der Einkaufsliste
      </div>
      <ul className="mt-2 flex flex-col gap-1 pl-7 text-sm text-[var(--color-muted-fg)]">
        {status.meals.map((meal) => (
          <li key={meal.mealPlanId}>
            <Link
              href={`/rezepte/${meal.recipeId}?meal=${meal.mealPlanId}`}
              className="font-medium text-[var(--color-fg)] hover:underline"
            >
              {meal.recipeTitle}
            </Link>{" "}
            — {meal.uncheckedItemCount} Artikel
            {meal.supermarkets.length > 0 ? (
              <>
                {" "}
                (
                {meal.supermarkets.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 ? ", " : null}
                    <Link
                      href={`/einkauf?supermarket=${s.id}`}
                      className="hover:underline"
                    >
                      {s.name}
                    </Link>
                  </span>
                ))}
                )
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-3 pl-7">
        <Link
          href="/einkauf"
          className="text-sm font-medium text-[var(--color-accent)] hover:underline"
        >
          Zur Einkaufsliste →
        </Link>
      </div>
    </div>
  );
}
