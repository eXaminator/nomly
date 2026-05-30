"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Recipe-detail button that marks the recipe for a later edit (or clears the
 * mark). Optimistic toggle backed by `PATCH /api/v1/recipes/[id]/needs-update`;
 * reverts on failure. `router.refresh()` re-renders the server view so the
 * flag stays consistent if the page is revisited.
 */
export function NeedsUpdateToggle({
  recipeId,
  initial,
  size,
}: {
  recipeId: number;
  initial: boolean;
  /** Forwarded to the underlying Button — use "sm" to match adjacent small
   *  buttons (e.g. in the recipe preview dialog header). */
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const router = useRouter();
  const [needsUpdate, setNeedsUpdate] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);

  async function toggle() {
    const next = !needsUpdate;
    setSaving(true);
    setNeedsUpdate(next);
    try {
      const res = await fetch(`/api/v1/recipes/${recipeId}/needs-update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ needsUpdate: next }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      router.refresh();
    } catch {
      setNeedsUpdate(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={toggle}
      disabled={saving}
      aria-pressed={needsUpdate}
      title={
        needsUpdate
          ? "Update-Markierung entfernen"
          : "Rezept für ein späteres Update vormerken"
      }
      className={cn(
        needsUpdate &&
          "border-[var(--color-warning)] bg-[color-mix(in_srgb,var(--color-warning),transparent_85%)] text-[var(--color-warning)] hover:bg-[color-mix(in_srgb,var(--color-warning),transparent_75%)]",
      )}
    >
      <Wrench className="size-4" />
      {needsUpdate ? "Update vorgemerkt" : "Update vormerken"}
    </Button>
  );
}
