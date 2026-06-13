"use client";

import Link from "next/link";
import { Clock, Pencil, Users, Wrench } from "lucide-react";
import type { RecipeListItem } from "@/lib/recipes/types";
import { cn } from "@/lib/cn";
import { DietBadge } from "./diet-badge";
import { FavoriteHeart } from "./favorite-heart";

type Props = { recipe: RecipeListItem };

export function RecipeCard({ recipe }: Props) {
  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] transition-colors hover:border-[var(--color-accent)]">
      <Link
        href={`/rezepte/${recipe.id}/bearbeiten`}
        onClick={(e) => e.stopPropagation()}
        aria-label={`„${recipe.title}" bearbeiten`}
        title="Direkt bearbeiten"
        className="absolute right-12 top-2 z-10 inline-flex size-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-card)]/85 text-[var(--color-fg)] opacity-0 backdrop-blur-sm transition-opacity hover:bg-[var(--color-card)] focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Pencil className="size-4" />
      </Link>
      <FavoriteHeart
        recipeId={recipe.id}
        initial={recipe.isFavorite}
        className="absolute right-2 top-2"
      />
      <Link
        href={`/rezepte/${recipe.id}`}
        className="flex h-full flex-col"
      >
      {recipe.needsUpdate ? (
        <span
          className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-[var(--color-warning)] px-2 py-0.5 text-[10px] font-medium text-white shadow-sm"
          title="Für ein Update vorgemerkt"
        >
          <Wrench className="size-3" />
          Update nötig
        </span>
      ) : null}
      <div className="aspect-video w-full shrink-0 overflow-hidden bg-[var(--color-muted)]">
        {recipe.photoPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/v1/${recipe.photoPath}`}
            alt={recipe.title}
            className="block h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--color-muted-fg)]">
            <span className="text-xs uppercase tracking-wider">Kein Foto</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-base font-semibold leading-snug text-[var(--color-fg)]">
          {recipe.title}
        </h3>
        {recipe.description ? (
          <p className="line-clamp-2 text-sm text-[var(--color-muted-fg)]">
            {recipe.description}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted-fg)]">
          <DietBadge
            isVegan={recipe.isVegan}
            isVegetarian={recipe.isVegetarian}
            confidence={recipe.dietConfidence}
            size="sm"
          />
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" />
            {recipe.servings}
          </span>
          {recipe.prepTimeMin || recipe.cookTimeMin ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" />
              {(recipe.prepTimeMin ?? 0) + (recipe.cookTimeMin ?? 0)} Min.
            </span>
          ) : null}
        </div>
        {recipe.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {recipe.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className={cn(
                  "rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-fg)]",
                )}
              >
                {tag}
              </span>
            ))}
            {recipe.tags.length > 4 ? (
              <span className="text-xs text-[var(--color-muted-fg)]">
                +{recipe.tags.length - 4}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      </Link>
    </div>
  );
}
