import * as React from "react";
import { CornerDownRight, Plus } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Chips for the members folded into a primary's note. Two kinds:
 *  - `alternative` (default): unmatched alternatives — the CornerDownRight icon;
 *    promoting one re-parses the line with that range emitted as an alternative.
 *  - `ingredient`: unmatched coordinated-list MAIN members ("A, B und C") — the
 *    Plus icon; promoting one re-parses with that range emitted as a MAIN.
 * Rendered inline next to the row's "Original:" line in both the recipe form and
 * the bulk-reparse dialog.
 */
export function FoldedAltChips({
  folded,
  onPromote,
  kind = "alternative",
}: {
  folded?: { range: [number, number]; label: string }[];
  onPromote: (range: [number, number]) => void;
  kind?: "alternative" | "ingredient";
}) {
  if (!folded || folded.length === 0) return null;
  const Icon = kind === "ingredient" ? Plus : CornerDownRight;
  const titleFor = (label: string) =>
    kind === "ingredient"
      ? `„${label}" als Zutat anlegen`
      : `„${label}" als Alternative anlegen`;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {folded.map((f, i) => (
        <button
          key={`${f.range[0]}-${f.range[1]}-${i}`}
          type="button"
          onClick={() => onPromote(f.range)}
          title={titleFor(f.label)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-dashed",
            "border-muted-foreground/40 px-2 py-0.5 text-xs text-muted-foreground",
            "transition-colors hover:border-foreground/60 hover:text-foreground",
          )}
        >
          <Icon className="size-3" />
          {f.label}
        </button>
      ))}
    </div>
  );
}
