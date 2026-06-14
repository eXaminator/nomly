"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Lock, Pencil } from "lucide-react";
import { cn } from "@/lib/cn";
import { isOptionalIngredient } from "@/lib/recipes/optional";

import {
  type EntityKind,
  type EntityRef,
  type ImpactRow,
  type IngredientConversionLink,
  type RecipeIngredientUsage,
  type RecipeLink,
} from "./types";

/**
 * Lazily fetch a single entity's impact row from /api/v1/<entity>/impact.
 * Fetches once when `enabled` first turns true, then caches — toggling
 * `enabled` back off doesn't drop or refetch the data. Each reference tab
 * reads its own slice of the returned row.
 */
export function useImpactData(
  entityKind: EntityKind,
  id: number,
  enabled: boolean,
) {
  const [data, setData] = React.useState<ImpactRow | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!enabled || data) return;
    let cancelled = false;
    // setState-in-effect: synchronizes external (server-fetched) impact data
    // into local state when the form first opens in edit mode.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch(`/api/v1/${pluralFor(entityKind)}/impact?ids=${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { items: ImpactRow[] };
      })
      .then((body) => {
        if (!cancelled) setData(body.items[0] ?? { id, refs: {}, aliasCount: 0 });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Konnte nicht laden.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, entityKind, id, data]);

  return { data, loading, error };
}

/**
 * Wraps a reference tab's body with the shared loading / error / empty states
 * so each list renderer can assume it has data to show.
 */
export function ReferencePane({
  loading,
  error,
  isEmpty,
  emptyText,
  children,
}: {
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-muted-fg)]">
        <Loader2 className="size-4 animate-spin" /> lädt…
      </div>
    );
  }
  if (error) {
    return <p className="text-sm text-[var(--color-danger)]">{error}</p>;
  }
  if (isEmpty) {
    return <p className="text-sm text-[var(--color-muted-fg)]">{emptyText}</p>;
  }
  return <>{children}</>;
}

/** Linked list of recipes, each optionally with its per-row usage details. */
export function RecipeReferenceList({ recipes }: { recipes: RecipeLink[] }) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {recipes.map((r) => (
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
  );
}

/** Linked list of articles whose unit conversions reference the unit. */
export function ConversionReferenceList({
  items,
}: {
  items: IngredientConversionLink[];
}) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {items.map((ing) => (
        <li key={ing.id}>
          <Link
            href={`/einstellungen/zutaten?edit=${ing.id}`}
            className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
          >
            {ing.name}
            <Pencil className="size-3" />
          </Link>
          <ul className="mt-1 ml-3 flex flex-col gap-0.5 text-xs text-[var(--color-muted-fg)]">
            {ing.conversions.map((c, i) => (
              <li key={i}>
                1 {c.fromUnitName} = {formatQuantity(c.factor)} {c.toUnitName}
                {c.isContainer ? " (Gebinde)" : ""}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** Linked list of plain core-data references (id + name) that deep-link into
 *  the matching Stammdaten editor via `editHref`. */
export function EntityReferenceList({
  items,
  editHref,
}: {
  items: EntityRef[];
  editHref: (id: number) => string;
}) {
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {items.map((it) => (
        <li key={it.id}>
          <Link
            href={editHref(it.id)}
            className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
          >
            {it.name}
            <Pencil className="size-3" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Mirrors the recipe-view ingredient row (see `src/app/rezepte/[id]/page.tsx`)
 * so the reference list reads the same way the recipe does: a monospace
 * quantity + unit on the left, the display name in the middle, and notes
 * after an em-dash. Optional rows render italic/muted; fixed-amount rows
 * get the lock icon.
 */
function UsageLine({ usage: u }: { usage: RecipeIngredientUsage }) {
  const unitLabel = u.displayUnit ?? u.unitName ?? "";
  return (
    <li
      className={cn(
        "flex gap-2",
        isOptionalIngredient(u) && "italic opacity-65",
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
        {isOptionalIngredient(u) ? (
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
    case "unit":
      return "units";
    case "category":
      return "categories";
    case "tag":
      return "tags";
    case "supermarket":
      return "supermarkets";
    case "quantifier":
      return "quantifiers";
  }
}
