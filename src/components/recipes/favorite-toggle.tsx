"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Recipe-detail button toggling the current user's favorite. Optimistic, backed
 * by `PATCH /api/v1/recipes/[id]/favorite`; reverts on failure and
 * `router.refresh()`es so the server view stays consistent. Mirrors
 * {@link NeedsUpdateToggle}.
 */
export function FavoriteToggle({
  recipeId,
  initial,
}: {
  recipeId: number;
  initial: boolean;
}) {
  const router = useRouter();
  const [favorite, setFavorite] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);

  async function toggle() {
    const next = !favorite;
    setSaving(true);
    setFavorite(next);
    try {
      const res = await fetch(`/api/v1/recipes/${recipeId}/favorite`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: next }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      router.refresh();
    } catch {
      setFavorite(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={toggle}
      disabled={saving}
      aria-pressed={favorite}
      title={favorite ? "Favorit entfernen" : "Als Favorit markieren"}
      className={cn(
        favorite &&
          "border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger),transparent_85%)] text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger),transparent_75%)]",
      )}
    >
      <Heart className={cn("size-4", favorite && "fill-current")} />
      {favorite ? "Favorit" : "Als Favorit"}
    </Button>
  );
}
