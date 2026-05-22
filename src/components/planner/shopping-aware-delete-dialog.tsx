"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ShoppingAwareDeleteChoice = "keep" | "subtract";

type Props = {
  open: boolean;
  mealTitle: string;
  /** When known, gives the user a sense of scale (item count). Hidden when null. */
  itemCount: number | null;
  onChoose: (choice: ShoppingAwareDeleteChoice) => Promise<void>;
  onCancel: () => void;
};

export function ShoppingAwareDeleteDialog({
  open,
  mealTitle,
  itemCount,
  onChoose,
  onCancel,
}: Props) {
  const [busy, setBusy] = React.useState(false);

  async function pick(choice: ShoppingAwareDeleteChoice) {
    setBusy(true);
    try {
      await onChoose(choice);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v && !busy ? onCancel() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mahlzeit löschen?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-[var(--color-fg)]">{mealTitle}</span>{" "}
            steht auf der Einkaufsliste
            {itemCount != null && itemCount > 0
              ? ` (${itemCount} ${itemCount === 1 ? "Artikel" : "Artikel"})`
              : ""}
            . Was soll mit den Einträgen passieren?
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm text-[var(--color-muted-fg)]">
          <li>
            <strong className="text-[var(--color-fg)]">Nur Mahlzeit löschen</strong>{" "}
            — Artikel bleiben unverändert auf der Liste.
          </li>
          <li>
            <strong className="text-[var(--color-fg)]">
              Mahlzeit und Zutaten entfernen
            </strong>{" "}
            — Mengen werden neu berechnet, leere Einträge gelöscht.
          </li>
        </ul>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Abbrechen
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => pick("keep")}
          >
            Nur Mahlzeit löschen
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => pick("subtract")}
          >
            Mahlzeit und Zutaten entfernen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
