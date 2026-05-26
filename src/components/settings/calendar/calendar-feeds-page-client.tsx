"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { CalendarFeedDialog } from "./calendar-feed-dialog";

export type FeedSummary = {
  id: number;
  name: string;
  url: string;
  color: string;
  enabled: boolean;
  sortOrder: number;
  lastFetchedAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  rawIcsFetchedAt: number | null;
  hasCachedBody: boolean;
};

type Props = { initial: FeedSummary[] };

export function CalendarFeedsPageClient({ initial }: Props) {
  const router = useRouter();
  const [feeds, setFeeds] = React.useState(initial);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setFeeds(initial), [initial]);
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<FeedSummary | null>(null);
  const [deleteCandidate, setDeleteCandidate] = React.useState<FeedSummary | null>(
    null,
  );
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function toggleEnabled(feed: FeedSummary, next: boolean) {
    setError(null);
    setBusyId(feed.id);
    // optimistic
    setFeeds((cur) => cur.map((f) => (f.id === feed.id ? { ...f, enabled: next } : f)));
    try {
      const res = await fetch(`/api/v1/ical-feeds/${feed.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error(await readError(res));
      router.refresh();
    } catch (e) {
      // rollback
      setFeeds((cur) =>
        cur.map((f) => (f.id === feed.id ? { ...f, enabled: !next } : f)),
      );
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusyId(null);
    }
  }

  async function refresh(feed: FeedSummary) {
    setError(null);
    setBusyId(feed.id);
    try {
      const res = await fetch(`/api/v1/ical-feeds/${feed.id}/refresh`, {
        method: "POST",
      });
      // 502 still returns JSON we want to surface
      const body = (await res.json().catch(() => ({}))) as
        | { ok: true; bytes: number; fetchedAt: number }
        | { ok: false; error: string };
      if ("ok" in body && body.ok === false) {
        setError(`Konnte „${feed.name}“ nicht laden: ${body.error}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteCandidate) return;
    setError(null);
    setBusyId(deleteCandidate.id);
    try {
      const res = await fetch(`/api/v1/ical-feeds/${deleteCandidate.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await readError(res));
      setDeleteCandidate(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
          Abonnierte Kalender
        </h2>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Hinzufügen
        </Button>
      </div>

      {error ? (
        <p className="rounded-[var(--radius)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {feeds.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center text-sm text-[var(--color-muted-fg)]">
          Noch keine Kalender. Füge einen iCal-Feed hinzu (z. B. aus Google
          Kalender oder einem geteilten Familienkalender), um Termine im
          Mahlzeitenplaner zu sehen.
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)]">
          {feeds.map((feed) => (
            <li key={feed.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-center gap-3">
                <span
                  aria-hidden
                  className="size-4 shrink-0 rounded-full border border-black/10 dark:border-white/10"
                  style={{ backgroundColor: feed.color }}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{feed.name}</span>
                  <span className="truncate text-xs text-[var(--color-muted-fg)]">
                    {feed.url}
                  </span>
                  <SyncStatus feed={feed} />
                </div>
              </div>
              <div className="flex items-center gap-1">
                <label className="flex items-center gap-2 px-2 text-xs text-[var(--color-muted-fg)]">
                  <Switch
                    checked={feed.enabled}
                    onCheckedChange={(v) => toggleEnabled(feed, Boolean(v))}
                    aria-label={`„${feed.name}“ aktiv`}
                  />
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Aktualisieren"
                  disabled={busyId === feed.id}
                  onClick={() => refresh(feed)}
                >
                  {busyId === feed.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Bearbeiten"
                  onClick={() => setEditing(feed)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Löschen"
                  className="text-[var(--color-danger)]"
                  onClick={() => setDeleteCandidate(feed)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <CalendarFeedDialog
          mode="create"
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            router.refresh();
          }}
        />
      ) : null}

      {editing ? (
        <CalendarFeedDialog
          mode="edit"
          feed={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      {deleteCandidate ? (
        <DeleteConfirm
          feed={deleteCandidate}
          busy={busyId === deleteCandidate.id}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

function SyncStatus({ feed }: { feed: FeedSummary }) {
  // Error wins over "ok" so the user sees the most recent failure.
  if (feed.lastErrorAt) {
    return (
      <span
        title={feed.lastErrorMessage ?? undefined}
        className="mt-0.5 inline-flex items-center gap-1 text-xs text-[var(--color-danger)]"
      >
        <AlertTriangle className="size-3" />
        Fehler — {formatRelative(feed.lastErrorAt)}
      </span>
    );
  }
  if (feed.rawIcsFetchedAt) {
    return (
      <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-[var(--color-muted-fg)]">
        <Check className="size-3 text-[var(--color-success)]" />
        Aktualisiert {formatRelative(feed.rawIcsFetchedAt)}
      </span>
    );
  }
  return (
    <span className="mt-0.5 text-xs text-[var(--color-muted-fg)]">
      Noch nicht synchronisiert
    </span>
  );
}

function formatRelative(unix: number): string {
  const deltaSec = Math.floor(Date.now() / 1000) - unix;
  if (deltaSec < 60) return "gerade eben";
  if (deltaSec < 3600) return `vor ${Math.floor(deltaSec / 60)} min`;
  if (deltaSec < 86400) return `vor ${Math.floor(deltaSec / 3600)} h`;
  return `vor ${Math.floor(deltaSec / 86400)} Tagen`;
}

function DeleteConfirm({
  feed,
  busy,
  onCancel,
  onConfirm,
}: {
  feed: FeedSummary;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        "fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center",
      )}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-xl"
      >
        <h3 className="text-lg font-semibold">Kalender löschen?</h3>
        <p className="mt-2 text-sm text-[var(--color-muted-fg)]">
          „{feed.name}“ wird entfernt. Die externe Quelle bleibt unverändert.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Lösche…" : "Löschen"}
          </Button>
        </div>
      </div>
    </div>
  );
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  return body.message ?? `HTTP ${res.status}`;
}
