"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

type Group = {
  id: number;
  name: string;
  sortOrder: number;
  itemCount: number;
};

type Props = {
  initial: Group[];
};

export function StapleGroupsPageClient({ initial }: Props) {
  const router = useRouter();
  const [groups, setGroups] = React.useState(initial);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setGroups(initial), [initial]);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [createBusy, setCreateBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = React.useState<Group | null>(
    null,
  );
  const [deleteBusy, setDeleteBusy] = React.useState(false);

  async function create() {
    const name = newName.trim();
    if (name === "") return;
    setCreateBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/staple-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        if (body.error === "duplicate_name") {
          setError("Es gibt schon eine Gruppe mit diesem Namen.");
          return;
        }
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      setNewName("");
      setCreating(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setCreateBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteCandidate) return;
    setDeleteBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/staple-groups/${deleteCandidate.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      setDeleteCandidate(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
          Gruppen
        </h2>
        {!creating ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCreating(true);
              setNewName("");
              setError(null);
            }}
          >
            <Plus className="size-4" />
            Neue Gruppe
          </Button>
        ) : null}
      </div>

      {creating ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-3 sm:flex-row sm:items-center">
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="z. B. Wocheneinkauf"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
              if (e.key === "Escape") {
                setCreating(false);
                setError(null);
              }
            }}
            className="flex-1"
          />
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setError(null);
              }}
              disabled={createBusy}
            >
              Abbrechen
            </Button>
            <Button
              onClick={create}
              disabled={createBusy || newName.trim().length === 0}
            >
              {createBusy ? "Speichert…" : "Anlegen"}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-[var(--color-danger)]">{error}</p>
      ) : null}

      {groups.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center text-sm text-[var(--color-muted-fg)]">
          Noch keine Gruppen. Lege eine an, um wiederkehrende Einkäufe wie Brot
          und Milch zu bündeln.
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)]">
          {groups.map((g) => (
            <li key={g.id} className="flex items-center gap-2 p-3">
              <Link
                href={`/einstellungen/standards/${g.id}`}
                className="flex flex-1 items-center gap-3 rounded-[var(--radius)] px-2 py-1 hover:bg-[var(--color-muted)] focus-visible:outline-none focus-visible:bg-[var(--color-muted)]"
              >
                <div className="flex flex-1 flex-col">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-xs text-[var(--color-muted-fg)]">
                    {g.itemCount} {g.itemCount === 1 ? "Artikel" : "Artikel"}
                  </span>
                </div>
                <ChevronRight className="size-4 text-[var(--color-muted-fg)]" />
              </Link>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Gruppe '${g.name}' löschen`}
                onClick={() => setDeleteCandidate(g)}
                className="text-[var(--color-danger)]"
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {deleteCandidate ? (
        <DeleteConfirm
          group={deleteCandidate}
          busy={deleteBusy}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

function DeleteConfirm({
  group,
  busy,
  onCancel,
  onConfirm,
}: {
  group: Group;
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
        <h3 className="text-lg font-semibold">Gruppe löschen?</h3>
        <p className="mt-2 text-sm text-[var(--color-muted-fg)]">
          „{group.name}&ldquo; wird gelöscht. Falls die Gruppe gerade
          Artikel auf der Einkaufsliste hat, werden die ebenfalls entfernt
          (nur Beiträge dieser Gruppe — Artikel mit anderen Quellen bleiben).
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
