"use client";

import { ChevronRight, PartyPopper, Store } from "lucide-react";
import { Button } from "@/components/ui/button";

export type NextStop = { id: number; name: string; count: number };

type Props = {
  /** Number of checked items, used to offer a jump to the Erledigt tab. */
  checkedCount: number;
  /** Stores that still have unchecked items (none → everything is bought). */
  nextStops: NextStop[];
  onShowChecked: () => void;
  /** Switch the supermarket filter to the picked store. */
  onPickStore: (supermarketId: number) => void;
};

/**
 * Celebratory state shown on the "Offen" tab when nothing is left to buy at the
 * current store. When other stores still have items, it doubles as a "next
 * stop" prompt; when nothing is left anywhere, it's a plain "all done". Distinct
 * from the dashed-border "Noch keine Artikel" hint, which means the list was
 * never populated.
 */
export function ShoppingDoneState({
  checkedCount,
  nextStops,
  onShowChecked,
  onPickStore,
}: Props) {
  const hasNextStops = nextStops.length > 0;

  return (
    <div className="flex flex-col items-center gap-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] px-6 py-14 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)] text-[var(--color-accent)]">
        <PartyPopper className="size-8" />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">
          {hasNextStops ? "Hier bist du fertig!" : "Alles erledigt!"}
        </h2>
        <p className="text-sm text-[var(--color-muted-fg)]">
          {hasNextStops
            ? "In diesem Supermarkt ist alles abgehakt."
            : "Du hast alles abgehakt. Zeit zum Auschecken."}
        </p>
      </div>

      {hasNextStops || checkedCount > 0 ? (
        <div className="mt-8 flex w-full max-w-sm flex-col gap-4 border-t border-[var(--color-border)] pt-12">
          {hasNextStops ? (
          <div className="flex flex-col gap-2 text-left">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
              Nächster Stopp
            </p>
            <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
              {nextStops.map((stop) => (
                <li key={stop.id}>
                  <button
                    type="button"
                    onClick={() => onPickStore(stop.id)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-[var(--color-muted)]/50"
                  >
                    <Store className="size-4 shrink-0 text-[var(--color-accent)]" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {stop.name}
                    </span>
                    <span className="shrink-0 text-[var(--color-muted-fg)] tabular-nums">
                      {stop.count} Artikel
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-[var(--color-muted-fg)]" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {checkedCount > 0 ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onShowChecked}
          >
            Erledigte anzeigen
          </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
