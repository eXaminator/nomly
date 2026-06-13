"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Corner favorite toggle for a recipe card. When the recipe is the viewer's
 * favorite the filled heart stays visible; otherwise an outline heart appears
 * on hover/focus like the edit pencil. Optimistic — `PATCH`es the favorite and
 * reverts on failure. Sits inside the card's nav Link, so it stops the click
 * from navigating.
 */
export function FavoriteHeart({
  recipeId,
  initial,
  className,
}: {
  recipeId: number;
  initial: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [favorite, setFavorite] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);

  // Keep in sync if the server view re-renders with a different value.
  React.useEffect(() => setFavorite(initial), [initial]);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
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
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      aria-pressed={favorite}
      aria-label={favorite ? "Favorit entfernen" : "Als Favorit markieren"}
      title={favorite ? "Favorit entfernen" : "Als Favorit markieren"}
      className={cn(
        "z-10 inline-flex size-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-card)]/85 backdrop-blur-sm transition-opacity hover:bg-[var(--color-card)] focus-visible:opacity-100",
        favorite
          ? "text-[var(--color-danger)] opacity-100"
          : "text-[var(--color-fg)] opacity-0 group-hover:opacity-100",
        className,
      )}
    >
      <Heart className={cn("size-4", favorite && "fill-current")} />
    </button>
  );
}
