"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

import {
  type EntityKind,
  type ImpactRow,
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
                  <ul className="flex flex-col gap-1">
                    {data.linkedRecipes.map((r) => (
                      <li key={r.id}>
                        <Link
                          href={`/rezepte/${r.id}`}
                          className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
                        >
                          {r.title}
                          <ExternalLink className="size-3" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {(data.refs.recipes ?? 0) > data.linkedRecipes.length && (
                    <p className="mt-1 text-xs text-[var(--color-muted-fg)]">
                      … und {(data.refs.recipes ?? 0) - data.linkedRecipes.length}{" "}
                      weitere.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
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
