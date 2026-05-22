"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => pick("keep")}
            className="justify-start"
          >
            Nur Mahlzeit löschen
            <span className="ml-2 text-xs text-[var(--color-muted-fg)]">
              Artikel bleiben unverändert auf der Liste.
            </span>
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => pick("subtract")}
            className="justify-start"
          >
            Mahlzeit und Zutaten entfernen
            <span className="ml-2 text-xs text-white/80">
              Mengen werden neu berechnet, leere Einträge gelöscht.
            </span>
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Abbrechen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
