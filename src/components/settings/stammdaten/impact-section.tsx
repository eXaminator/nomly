"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/cn";

import {
  type EntityKind,
  type ImpactRow,
  type RecipeIngredientUsage,
  REF_LABELS,
  refsSum,
} from "./types";

export type ImpactSectionProps = {
  entityKind: EntityKind;
  id: number;
  /** Initial impact, when known. If omitted, the section fetches on expand. */
  initial?: ImpactRow;
};

/**
 * Expandable "Verwendung anzeigen" inside the drawer. Lazy-loads impact from
 * /api/v1/<entity>/impact when first expanded (no preload).
 */
export function ImpactSection({ entityKind, id, initial }: ImpactSectionProps) {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<ImpactRow | null>(initial ?? null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function ensureLoaded() {
    if (data) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/${pluralFor(entityKind)}/impact?ids=${id}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { items: ImpactRow[] };
      setData(body.items[0] ?? { id, refs: {}, aliasCount: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Konnte nicht laden.");
    } finally {
      setLoading(false);
    }
  }

  const total = data ? refsSum(data.refs) : null;

  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void ensureLoaded();
        }}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm"
        aria-expanded={open}
      >
        <span className="font-medium">
          Verwendung
          {total != null && (
            <span className="ml-2 text-[var(--color-muted-fg)]">
              ({total === 0 ? "nirgendwo" : `${total} Referenzen`})
            </span>
          )}
        </span>
        <ChevronDown
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="border-t border-[var(--color-border)] px-4 py-3 text-sm">
          {loading && (
            <div className="flex items-center gap-2 text-[var(--color-muted-fg)]">
              <Loader2 className="size-4 animate-spin" /> lädt…
            </div>
          )}
          {error && (
            <p className="text-[var(--color-danger)]">{error}</p>
          )}
          {data && !loading && !error && (
            <div className="flex flex-col gap-3">
              <ul className="flex flex-col gap-1">
                {Object.entries(data.refs).filter(([, n]) => n > 0).length ===
                0 ? (
                  <li className="text-[var(--color-muted-fg)]">
                    Diese Zeile wird nirgendwo verwendet.
                  </li>
                ) : (
                  Object.entries(data.refs)
                    .filter(([, n]) => n > 0)
                    .map(([key, count]) => (
                      <li key={key} className="flex justify-between gap-2">
                        <span className="text-[var(--color-muted-fg)]">
                          {REF_LABELS[key] ?? key}
                        </span>
                        <span className="font-medium">{count}</span>
                      </li>
                    ))
                )}
                {data.aliasCount > 0 && (
                  <li className="flex justify-between gap-2">
                    <span className="text-[var(--color-muted-fg)]">Aliase</span>
                    <span className="font-medium">{data.aliasCount}</span>
                  </li>
                )}
              </ul>

              {data.linkedRecipes && data.linkedRecipes.length > 0 && (
                <div className="border-t border-[var(--color-border)] pt-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
                    Rezepte
                  </p>
                  <ul className="flex flex-col gap-2">
                    {data.linkedRecipes.map((r) => (
                      <li key={r.id}>
                        <Link
                          href={`/rezepte/${r.id}`}
                          className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
                        >
                          {r.title}
                          <ExternalLink className="size-3" />
                        </Link>
                        {r.usages && r.usages.length > 0 && (
                          <ul className="mt-1 ml-3 flex flex-col gap-0.5 text-xs">
                            {r.usages.map((u, i) => (
                              <UsageLine key={i} usage={u} />
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                  {(() => {
                    // `refs.recipes` counts recipe_ingredient ROWS, not
                    // distinct recipes — so for ingredients that show up in
                    // multiple rows of the same recipe, the raw count
                    // outruns `linkedRecipes.length`. Comparing against the
                    // total number of usage lines we actually render (sum
                    // of `usages` arrays, falling back to 1 per recipe when
                    // we don't carry usages) is the honest threshold.
                    const totalShown = data.linkedRecipes!.reduce(
                      (n, r) => n + (r.usages?.length ?? 1),
                      0,
                    );
                    const total = data.refs.recipes ?? 0;
                    if (total <= totalShown) return null;
                    return (
                      <p className="mt-1 text-xs text-[var(--color-muted-fg)]">
                        … und {total - totalShown} weitere.
                      </p>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Mirrors the recipe-view ingredient row (see `src/app/rezepte/[id]/page.tsx`)
 * so the "Verwendung" list reads the same way the recipe does: a monospace
 * quantity + unit on the left, the display name in the middle, and notes
 * after an em-dash. Optional rows render italic/muted; fixed-amount rows
 * get the lock icon.
 */
function UsageLine({ usage: u }: { usage: RecipeIngredientUsage }) {
  const unitLabel = u.displayUnit ?? u.subUnitName ?? u.unitName ?? "";
  return (
    <li
      className={cn(
        "flex gap-2",
        u.isOptional && "italic opacity-65",
      )}
    >
      <span className="inline-flex min-w-10 items-center gap-1 font-mono text-[var(--color-muted-fg)]">
        {u.fixedAmount ? (
          <Lock className="size-3 shrink-0" aria-label="Feste Menge" />
        ) : null}
        <span>
          {u.quantity != null ? formatQuantity(u.quantity) : ""}
          {unitLabel ? ` ${unitLabel}` : ""}
        </span>
      </span>
      <span className="flex-1 text-[var(--color-fg)]">
        {u.displayName ?? ""}
        {u.notes ? (
          <span className="text-[var(--color-muted-fg)]"> – {u.notes}</span>
        ) : null}
        {u.isOptional ? (
          <span className="ml-1 text-[var(--color-muted-fg)]">(optional)</span>
        ) : null}
      </span>
    </li>
  );
}

function formatQuantity(q: number): string {
  const rounded = Math.round(q * 100) / 100;
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(
    rounded,
  );
}

function pluralFor(kind: EntityKind): string {
  switch (kind) {
    case "ingredient":
      return "ingredients";
    case "product":
      return "products";
    case "unit":
      return "units";
    case "category":
      return "categories";
    case "tag":
      return "tags";
    case "supermarket":
      return "supermarkets";
  }
}
