"use client";

import * as React from "react";
import { ExternalLink, Loader2, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImportFailure } from "@/lib/recipes/import-failures";

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

type Props = {
  failures: ImportFailure[];
  /** Retry the import of a URL (disabled while an import is running). */
  onRetry: (url: string) => void;
  /** Remove an entry; resolves when the server has dropped it. */
  onRemove: (id: number) => Promise<void>;
  busy: boolean;
};

/**
 * "Fehlgeschlagene Importe": URLs the importer couldn't handle, so the
 * importer can be fixed and the import retried. Also reachable via
 * GET/DELETE /api/v1/recipes/import-failures.
 */
export function ImportFailureList({ failures, onRetry, onRemove, busy }: Props) {
  const [removing, setRemoving] = React.useState<number | null>(null);

  if (failures.length === 0) return null;

  async function remove(id: number) {
    setRemoving(id);
    try {
      await onRemove(id);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          Fehlgeschlagene Importe
        </h2>
        <p className="text-sm text-[var(--color-muted-fg)]">
          Diese Links konnten nicht importiert werden. Sobald du ein Rezept
          von einem dieser Links importiert und gespeichert hast, verschwindet
          der Eintrag automatisch.
        </p>
      </div>
      <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)]">
        {failures.map((f) => (
          <li
            key={f.id}
            className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"
              >
                <span className="truncate">{f.url}</span>
                <ExternalLink className="size-3.5 shrink-0 text-[var(--color-muted-fg)]" />
              </a>
              <p className="text-sm text-[var(--color-danger)]">
                {f.errorMessage}
              </p>
              <p className="text-xs text-[var(--color-muted-fg)]">
                {dateFmt.format(new Date(f.lastAttemptAt * 1000))}
                {f.attempts > 1 ? ` · ${f.attempts} Versuche` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onRetry(f.url)}
              >
                <RotateCw className="size-4" />
                Erneut versuchen
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Eintrag entfernen"
                title="Eintrag entfernen"
                disabled={removing === f.id}
                onClick={() => void remove(f.id)}
              >
                {removing === f.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
