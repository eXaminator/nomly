import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type ShoppingStoreSummary = {
  id: number;
  name: string;
  /** Unchecked items this store carries. */
  count: number;
};

/**
 * Dashboard card: how many items are still open on the shopping list, broken
 * down per supermarket. Store rows deep-link via `?supermarket=` (the same
 * link the Home Assistant notification uses), which also persists the
 * selection in the list view.
 */
export function ShoppingSummaryCard({
  openCount,
  stores,
  className,
}: {
  openCount: number;
  stores: ShoppingStoreSummary[];
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-baseline justify-between">
        <CardTitle>Einkaufsliste</CardTitle>
        <Link
          href="/einkauf"
          className="text-sm font-medium text-[var(--color-accent)] hover:underline"
        >
          Zur Liste →
        </Link>
      </CardHeader>
      <CardContent>
        {openCount === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">
            Alles erledigt — die Liste ist leer.
          </p>
        ) : (
          <>
            <p className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums text-[var(--color-fg)]">
                {openCount}
              </span>
              <span className="text-sm text-[var(--color-muted-fg)]">
                {openCount === 1 ? "offener Artikel" : "offene Artikel"}
              </span>
            </p>
            {stores.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1">
                {stores.map((store) => (
                  <li key={store.id}>
                    <Link
                      href={`/einkauf?supermarket=${store.id}`}
                      className="group flex min-h-11 items-center justify-between gap-2 rounded-md px-2 -mx-2 text-sm hover:bg-[var(--color-muted)]/50"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <ShoppingCart className="size-4 shrink-0 text-[var(--color-muted-fg)]" />
                        <span className="truncate font-medium text-[var(--color-fg)] group-hover:underline">
                          {store.name}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-[var(--color-muted-fg)]">
                        {store.count}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
