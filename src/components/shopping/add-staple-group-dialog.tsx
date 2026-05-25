"use client";

import * as React from "react";
import Link from "next/link";
import { ListPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addStapleGroupToList } from "./api";

type Group = {
  id: number;
  name: string;
  sortOrder: number;
  itemCount: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onAdded: (group: Group, summary: { itemsCreated: number; itemsIncremented: number; affectedItemIds: number[] }) => void;
};

export function AddStapleGroupDialog({ open, onClose, onAdded }: Props) {
  const [groups, setGroups] = React.useState<Group[] | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGroups(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch("/api/v1/staple-groups", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { groups: Group[] };
        if (!cancelled) setGroups(data.groups);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Fehler");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function pick(g: Group) {
    setBusyId(g.id);
    setError(null);
    try {
      const result = await addStapleGroupToList(g.id);
      onAdded(g, result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => (!v && busyId == null ? onClose() : undefined)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Standards hinzufügen</DialogTitle>
          <DialogDescription>
            Eine Gruppe wählen — alle Artikel der Gruppe werden zur Liste
            hinzugefügt.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-2">
          {groups == null && error == null ? (
            <p className="text-sm text-[var(--color-muted-fg)]">Lädt…</p>
          ) : null}
          {error ? (
            <p className="text-sm text-[var(--color-danger)]">{error}</p>
          ) : null}
          {groups != null && groups.length === 0 ? (
            <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-6 py-8 text-center text-sm text-[var(--color-muted-fg)]">
              Noch keine Gruppen.
              <div className="mt-3">
                <Button asChild variant="outline" size="sm">
                  <Link href="/einstellungen/standards">Jetzt anlegen</Link>
                </Button>
              </div>
            </div>
          ) : null}
          {groups != null && groups.length > 0 ? (
            <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)]">
              {groups.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    disabled={busyId != null}
                    onClick={() => pick(g)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left hover:bg-[var(--color-muted)] focus-visible:outline-none focus-visible:bg-[var(--color-muted)] disabled:opacity-60"
                  >
                    <span className="flex items-center gap-2">
                      <ListPlus className="size-4 text-[var(--color-muted-fg)]" />
                      <span className="font-medium">{g.name}</span>
                    </span>
                    <span className="text-xs text-[var(--color-muted-fg)]">
                      {busyId === g.id
                        ? "Fügt hinzu…"
                        : `${g.itemCount} ${g.itemCount === 1 ? "Artikel" : "Artikel"}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busyId != null}>
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
