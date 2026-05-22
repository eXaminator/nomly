"use client";

import * as React from "react";
import Link from "next/link";
import { Clock, ExternalLink, Pencil, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DietBadge } from "@/components/recipes/diet-badge";
import { IngredientLine } from "@/components/recipes/ingredient-line";
import { renderMarkdown } from "@/lib/markdown";
import type { RecipeView } from "@/lib/recipes/types";

type Props = {
  recipeId: number | null;
  onClose: () => void;
};

function formatQuantity(q: number | null): string {
  if (q === null) return "";
  const rounded = Math.round(q * 100) / 100;
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(rounded);
}

export function RecipePreviewDialog({ recipeId, onClose }: Props) {
  const open = recipeId != null;
  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto p-0">
        {/* Remount on every new recipeId so the inner body re-fetches with
            a fresh loading state — avoids setState-in-effect resets. */}
        {recipeId != null ? <RecipeBody key={recipeId} recipeId={recipeId} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function RecipeBody({ recipeId }: { recipeId: number }) {
  const [recipe, setRecipe] = React.useState<RecipeView | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/recipes/${recipeId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = (await res.json()) as RecipeView;
        if (!cancelled) setRecipe(data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Fehler beim Laden");
      });
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  if (error) {
    return (
      <div className="p-6">
        <DialogHeader>
          <DialogTitle>Rezept konnte nicht geladen werden</DialogTitle>
        </DialogHeader>
        <p className="mt-2 text-sm text-[var(--color-muted-fg)]">{error}</p>
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="p-6">
        <DialogHeader>
          <DialogTitle className="opacity-70">Wird geladen…</DialogTitle>
        </DialogHeader>
      </div>
    );
  }

  const descriptionHtml = renderMarkdown(recipe.description);

  return (
    <div className="flex flex-col">
      {recipe.photoPath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/v1/${recipe.photoPath}`}
          alt={recipe.title}
          className="aspect-[16/9] w-full object-cover"
        />
      ) : null}
      <div className="space-y-6 p-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1">
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              {recipe.title}
            </DialogTitle>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[var(--color-muted-fg)]">
              <DietBadge
                isVegan={recipe.isVegan}
                isVegetarian={recipe.isVegetarian}
              />
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-4" />
                {recipe.servings} Portion{recipe.servings === 1 ? "" : "en"}
              </span>
              {recipe.prepTimeMin ? (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-4" />
                  Vorb. {recipe.prepTimeMin} Min.
                </span>
              ) : null}
              {recipe.cookTimeMin ? (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-4" />
                  Kochzeit {recipe.cookTimeMin} Min.
                </span>
              ) : null}
              {recipe.sourceUrl ? (
                <a
                  href={recipe.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 underline underline-offset-2 hover:text-[var(--color-fg)]"
                >
                  <ExternalLink className="size-4" />
                  Quelle
                </a>
              ) : null}
            </div>
            {recipe.tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {recipe.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-[var(--color-muted)] px-2.5 py-0.5 text-xs text-[var(--color-fg)]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/rezepte/${recipe.id}`}>Vollansicht</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/rezepte/${recipe.id}/bearbeiten`}>
                <Pencil className="size-4" />
                Bearbeiten
              </Link>
            </Button>
          </div>
        </header>

        {descriptionHtml ? (
          <div
            className="markdown text-[var(--color-fg)]"
            dangerouslySetInnerHTML={{ __html: descriptionHtml }}
          />
        ) : null}

        <div className="space-y-8">
          {recipe.sections.map((section) => {
            const html = renderMarkdown(section.instructions);
            return (
              <section key={section.id} className="space-y-3">
                {section.title ? (
                  <h3 className="text-lg font-semibold tracking-tight">
                    {section.title}
                  </h3>
                ) : null}
                <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
                  <ul className="space-y-1 text-sm">
                    {section.ingredients.map((ing) => (
                      <li
                        key={ing.id}
                        className={
                          ing.isOptional ? "flex gap-2 italic opacity-65" : "flex gap-2"
                        }
                      >
                        <span className="min-w-12 font-mono text-[var(--color-muted-fg)]">
                          {formatQuantity(ing.quantity)} {ing.unitName ?? ""}
                        </span>
                        <span className="flex-1">
                          <IngredientLine
                            displayName={ing.ingredientName}
                            canonicalName={ing.canonicalIngredientName}
                          />
                          {ing.notes ? (
                            <span className="text-[var(--color-muted-fg)]"> – {ing.notes}</span>
                          ) : null}
                          {ing.isOptional ? (
                            <span className="ml-1 text-xs text-[var(--color-muted-fg)]">
                              (optional)
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {html ? (
                    <article
                      className="markdown text-[var(--color-fg)]"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
