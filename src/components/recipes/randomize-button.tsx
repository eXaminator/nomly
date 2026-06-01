"use client";

import { Dices, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useRandomize } from "./randomize-context";

/**
 * List control: reduces the filtered list to a few random recipes. Inactive it
 * shows a single "Zufällig" pill; active it becomes a split button — a
 * "Neu würfeln" re-roll segment joined to an "✕" reset segment that returns to
 * the full filtered list. Disabled when nothing matches. The selection is
 * ephemeral and clears whenever a filter changes.
 */
export function RandomizeButton() {
  const { active, available, roll, reset } = useRandomize();

  if (!active) {
    return (
      <button
        type="button"
        aria-pressed={false}
        disabled={available === 0}
        onClick={roll}
        title="Ein paar zufällige Rezepte aus der aktuellen Auswahl zeigen"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
          "border-[var(--color-border)] text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <Dices className="size-3.5" />
        Zufällig
      </button>
    );
  }

  // Active: one visual pill split into a re-roll segment and a reset segment,
  // sharing a single accent-filled border with a hairline divider between them.
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-full border border-[var(--color-success)] bg-[var(--color-success)] text-xs font-medium text-white">
      <button
        type="button"
        aria-pressed
        onClick={roll}
        title="Neue zufällige Auswahl würfeln"
        className="inline-flex items-center gap-1.5 px-3 py-1 transition-colors hover:bg-black/10"
      >
        <Dices className="size-3.5" />
        Neu würfeln
      </button>
      <button
        type="button"
        onClick={reset}
        title="Zufallsauswahl aufheben"
        aria-label="Zufallsauswahl aufheben"
        className="inline-flex items-center border-l border-white/30 px-2 transition-colors hover:bg-black/10"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
