"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";

type Props = {
  displayName: string;
  /** Canonical article name, or null for "Nicht zugeordnet" lines that aren't
   *  linked to any article — those render as plain text with no disclosure. */
  canonicalName: string | null;
};

/**
 * Renders a recipe ingredient name with a popover that surfaces the canonical
 * row when the user picked an alias. Popover (vs hover-only tooltip) so it
 * works on touch — tap toggles, tap-outside / Escape closes. When display ==
 * canonical (the common case) we render plain text with no disclosure.
 */
export function IngredientLine({ displayName, canonicalName }: Props) {
  const showDisclosure =
    canonicalName != null &&
    canonicalName.trim().length > 0 &&
    canonicalName.toLowerCase() !== displayName.toLowerCase();

  if (!showDisclosure) return <>{displayName}</>;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="cursor-pointer underline decoration-dotted decoration-[var(--color-muted-fg)] underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:rounded-sm"
        >
          {displayName}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-w-xs rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-xs text-[var(--color-fg)] shadow-md"
        >
          Zugeordnet zu <strong>{canonicalName}</strong>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
