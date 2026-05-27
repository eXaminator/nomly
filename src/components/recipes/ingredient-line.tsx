"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Props = {
  displayName: string;
  /** Canonical article name, or null for "Nicht zugeordnet" lines that aren't
   *  linked to any article — those render as plain text with no tooltip. */
  canonicalName: string | null;
};

/**
 * Renders a recipe ingredient name with a tooltip that surfaces the canonical
 * row when the user picked an alias. When display == canonical (the common
 * case) we render plain text without a tooltip — no need to draw attention.
 */
export function IngredientLine({ displayName, canonicalName }: Props) {
  const showTooltip =
    canonicalName != null &&
    canonicalName.trim().length > 0 &&
    canonicalName.toLowerCase() !== displayName.toLowerCase();

  if (!showTooltip) return <>{displayName}</>;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dotted decoration-[var(--color-muted-fg)] underline-offset-4">
            {displayName}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="start">
          Zugeordnet zu <strong>{canonicalName}</strong>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
