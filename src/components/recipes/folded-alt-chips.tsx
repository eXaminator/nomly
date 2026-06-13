import * as React from "react";
import { CornerDownRight } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * "Create alternative" chips for the unmatched alternatives folded into a
 * primary's note. Each chip promotes one folded alternative to its own row
 * (the parent re-parses the line with that range emitted). Rendered inline next
 * to the row's "Original:" line, with the alternatives icon (CornerDownRight),
 * in both the recipe form and the bulk-reparse dialog.
 */
export function FoldedAltChips({
  folded,
  onPromote,
}: {
  folded?: { range: [number, number]; label: string }[];
  onPromote: (range: [number, number]) => void;
}) {
  if (!folded || folded.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {folded.map((f, i) => (
        <button
          key={`${f.range[0]}-${f.range[1]}-${i}`}
          type="button"
          onClick={() => onPromote(f.range)}
          title={`„${f.label}" als Alternative anlegen`}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-dashed",
            "border-muted-foreground/40 px-2 py-0.5 text-xs text-muted-foreground",
            "transition-colors hover:border-foreground/60 hover:text-foreground",
          )}
        >
          <CornerDownRight className="size-3" />
          {f.label}
        </button>
      ))}
    </div>
  );
}
