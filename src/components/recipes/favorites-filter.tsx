"use client";

import * as React from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUrlString } from "@/lib/url-state";

export type FavoriteUserOption = { id: number; name: string };

/**
 * Recipe-list favorites filter: a "★ Favoriten" toggle plus a user dropdown.
 * URL-backed via `?fav=<userId>` (absent = off). The dropdown defaults to the
 * current user (labeled "Meine"); picking another user filters to theirs.
 * Rendered only on the main `/rezepte` list (where a user list is available).
 */
export function FavoritesFilter({
  users,
  currentUserId,
}: {
  users: FavoriteUserOption[];
  currentUserId: number | null;
}) {
  const [fav, setFav] = useUrlString<string>("fav", "");
  const active = fav !== "";
  const fallback = currentUserId ?? users[0]?.id ?? null;
  const [selected, setSelected] = React.useState<number | null>(
    active ? Number(fav) : fallback,
  );

  // Keep the dropdown in sync when the URL changes to a concrete user (back
  // navigation, or another control clearing the filter).
  React.useEffect(() => {
    if (active) setSelected(Number(fav));
  }, [fav, active]);

  if (users.length === 0) return null;

  const labelFor = (u: FavoriteUserOption) =>
    u.id === currentUserId ? "Meine" : u.name;

  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-full border border-[var(--color-border)]">
      <button
        type="button"
        aria-pressed={active}
        onClick={() => setFav(active ? "" : String(selected ?? fallback ?? ""))}
        title="Nur Favoriten zeigen"
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium transition-colors",
          active
            ? "bg-[var(--color-danger)] text-white"
            : "text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]",
        )}
      >
        <Heart className={cn("size-3.5", active && "fill-current")} />
        Favoriten
      </button>
      <select
        aria-label="Favoriten von"
        value={selected ?? ""}
        onChange={(e) => {
          const id = Number(e.target.value);
          setSelected(id);
          if (active) setFav(String(id));
        }}
        className="border-l border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-xs text-[var(--color-fg)] focus:outline-none"
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {labelFor(u)}
          </option>
        ))}
      </select>
    </div>
  );
}
