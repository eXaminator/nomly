"use client";

import * as React from "react";
import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";

type Props = {
  /** Which adjacent range this button navigates to / drops into. */
  direction: "previous" | "next";
  /** First day of the next range / last day of the previous range. */
  targetDate: string;
  /** Plain click still just navigates (see goPrevious/goNext). */
  onClick: () => void;
  /** Active only while a meal is being dragged — recipe drags stay inert. */
  dropDisabled: boolean;
};

const LABEL = { previous: "Vorherige", next: "Nächste" } as const;

/**
 * The full-width range-navigation buttons above/below the calendar. They also
 * double as drop targets: releasing a dragged meal here moves it to
 * `targetDate` (the edge day of the adjacent range) without leaving the
 * current view.
 */
export function RangeNavButton({
  direction,
  targetDate,
  onClick,
  dropDisabled,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `range:${direction}`,
    data: { type: "shift-range", direction, targetDate },
    disabled: dropDisabled,
  });
  const Icon = direction === "previous" ? ChevronUp : ChevronDown;
  const highlighted = isOver && !dropDisabled;

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      aria-label={LABEL[direction]}
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border border-dashed border-[var(--color-border)] py-2 text-xs text-[var(--color-muted-fg)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
        highlighted &&
          "border-solid border-[var(--color-accent)] bg-[var(--color-muted)] text-[var(--color-accent)]",
      )}
    >
      <Icon className="size-4" aria-hidden />
      <span>{LABEL[direction]}</span>
    </button>
  );
}
