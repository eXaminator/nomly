"use client";

import * as React from "react";
import { Info } from "lucide-react";

export type CrossCollisionHit = {
  ingredientName: string;
  unitName: string | null;
};

export type CrossCollisionMap = Map<string, CrossCollisionHit[]>;

/**
 * Debounced lookup of other ingredients already using any of the given names
 * (canonical or alias). NOT blocking — the line's unit disambiguates at match
 * time — so the result is rendered as an advisory note via
 * {@link CrossCollisionNote}. Keyed by lowercased name. Pass `excludeId` to skip
 * the ingredient being edited.
 */
export function useCrossIngredientCollisions(
  names: string[],
  excludeId?: number,
  /** When false, the lookup is skipped (and the map cleared). Lets a collapsed
   *  section avoid firing a request per card until it's actually opened. */
  enabled = true,
): CrossCollisionMap {
  const [collisions, setCollisions] = React.useState<CrossCollisionMap>(
    new Map(),
  );
  const namesKey = names.map((n) => n.trim()).join("\0");

  React.useEffect(() => {
    const unique = enabled
      ? Array.from(
          new Set(names.map((n) => n.trim()).filter((n) => n.length > 0)),
        )
      : [];
    if (unique.length === 0) {
      // Clear stale hits when there's nothing to look up (or while disabled).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollisions(new Map());
      return;
    }
    const ac = new AbortController();
    const timer = setTimeout(async () => {
      const next: CrossCollisionMap = new Map();
      await Promise.all(
        unique.map(async (n) => {
          const params = new URLSearchParams({ name: n });
          if (excludeId != null) params.set("excludeId", String(excludeId));
          try {
            const res = await fetch(
              `/api/v1/ingredients/alias-collisions?${params.toString()}`,
              { signal: ac.signal },
            );
            if (!res.ok) return;
            const body = (await res.json()) as { collisions: CrossCollisionHit[] };
            if (body.collisions.length > 0)
              next.set(n.toLowerCase(), body.collisions);
          } catch {
            // Aborted or network error — advisory only, ignore.
          }
        }),
      );
      if (!ac.signal.aborted) setCollisions(next);
    }, 400);
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey, excludeId, enabled]);

  return collisions;
}

/** Advisory "also used by …" note for a name that collides with other
 *  ingredients. Renders nothing when there are no hits. */
export function CrossCollisionNote({
  hits,
}: {
  hits: CrossCollisionHit[] | undefined;
}) {
  if (!hits || hits.length === 0) return null;
  const label = hits
    .map((h) =>
      h.unitName ? `${h.ingredientName} (${h.unitName})` : h.ingredientName,
    )
    .join(", ");
  return (
    <p className="flex items-center gap-1 text-xs text-[var(--color-muted-fg)]">
      <Info className="size-3 shrink-0" aria-hidden />
      Auch verwendet von: {label}. Die Einheit entscheidet beim Zuordnen.
    </p>
  );
}
