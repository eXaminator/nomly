"use client";

import { Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUrlBoolean } from "@/lib/url-state";

/**
 * List filter toggle: when on, the recipe list shows only recipes flagged
 * "needs update". URL-backed (`?update=1`) so it composes with the other
 * `/rezepte` filters and survives reload / back-navigation.
 */
export function NeedsUpdateFilter() {
  const [active, setActive] = useUrlBoolean("update");
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setActive(!active)}
      title="Nur Rezepte zeigen, die ein Update brauchen"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-[var(--color-warning)] bg-[var(--color-warning)] text-white"
          : "border-[var(--color-border)] text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]",
      )}
    >
      <Wrench className="size-3.5" />
      Update nötig
    </button>
  );
}
