"use client";

import { Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUrlBoolean } from "@/lib/url-state";

type Props = {
  /** Controlled value. When both `value` and `onChange` are passed, the
   *  component reads state from this prop and reports changes via the callback
   *  instead of writing to the URL — used by the planner's recipe filters. */
  value?: boolean;
  onChange?: (next: boolean) => void;
};

/**
 * List filter toggle: when on, the recipe list shows only recipes flagged
 * "needs update". URL-backed (`?update=1`) by default so it composes with the
 * other `/rezepte` filters and survives reload / back-navigation; controlled
 * when given `value`/`onChange` (the planner keeps filter state in React).
 */
export function NeedsUpdateFilter({ value, onChange }: Props = {}) {
  const isControlled = value != null && onChange != null;
  // The URL hook is always called (hooks rules); its setter is only used in
  // uncontrolled mode. Reading `update` on a page that doesn't use it just
  // yields the default and is harmless.
  const [urlActive, setUrlActive] = useUrlBoolean("update");
  const active = isControlled ? value : urlActive;
  const setActive = (next: boolean) =>
    isControlled ? onChange(next) : setUrlActive(next);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setActive(!active)}
      title="Nur Rezepte zeigen, die ein Update brauchen"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-[var(--color-success)] bg-[var(--color-success)] text-white"
          : "border-[var(--color-border)] text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]",
      )}
    >
      <Wrench className="size-3.5" />
      Update nötig
    </button>
  );
}
