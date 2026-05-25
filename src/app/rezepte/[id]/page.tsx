import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, ExternalLink, Lock, Pencil, Users } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { DietBadge } from "@/components/recipes/diet-badge";
import { IngredientLine } from "@/components/recipes/ingredient-line";
import { getRecipe } from "@/lib/recipes/service";
import { renderMarkdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";

function formatQuantity(q: number | null): string {
  if (q === null) return "";
  const rounded = Math.round(q * 100) / 100;
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(rounded);
}

export default async function RecipeViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const recipe = getRecipe(id);
  if (!recipe) notFound();

  const descriptionHtml = renderMarkdown(recipe.description);

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          <h1 className="text-3xl font-semibold tracking-tight">{recipe.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-[var(--color-muted-fg)]">
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
                Vorbereitung {recipe.prepTimeMin} Min.
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
        <Button asChild variant="outline">
          <Link href={`/rezepte/${recipe.id}/bearbeiten`}>
            <Pencil className="size-4" />
            Bearbeiten
          </Link>
        </Button>
      </div>

      {recipe.photoPath ? (
        <div className="mt-6 overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
          {/* Capped at ~18rem so the title + ingredients stay visible above
              the fold on a typical laptop viewport. `object-cover` crops to
              the cap; the image always fills the width. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/v1/${recipe.photoPath}`}
            alt={recipe.title}
            className="h-72 w-full object-cover"
          />
        </div>
      ) : null}

      {descriptionHtml ? (
        <div
          className="markdown mt-6 text-[var(--color-fg)]"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />
      ) : null}

      <div className="mt-8 space-y-12">
        {recipe.sections.map((section) => {
          const html = renderMarkdown(section.instructions);
          const consumables = section.ingredients.filter((i) => !i.isEquipment);
          const equipment = section.ingredients.filter((i) => i.isEquipment);

          const renderIngredient = (ing: (typeof section.ingredients)[number]) => (
            <li
              key={ing.id}
              className={ing.isOptional ? "flex gap-2 italic opacity-65" : "flex gap-2"}
            >
              <span className="inline-flex min-w-12 items-center gap-1 font-mono text-[var(--color-muted-fg)]">
                {ing.fixedAmount ? (
                  <Lock className="size-3 shrink-0" aria-label="Feste Menge" />
                ) : null}
                <span>
                  {formatQuantity(ing.quantity)} {ing.unitName ?? ""}
                </span>
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
          );

          const ingredientList = (
            <div className="space-y-4">
              <ul className="space-y-1 text-sm text-[var(--color-fg)]">
                {consumables.map(renderIngredient)}
              </ul>
              {equipment.length > 0 ? (
                <div className="space-y-1">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-fg)]">
                    Du brauchst auch
                  </h3>
                  <ul className="space-y-1 text-sm text-[var(--color-fg)]">
                    {equipment.map(renderIngredient)}
                  </ul>
                </div>
              ) : null}
            </div>
          );
          // Empty-state for instructions only makes sense for a single-section
          // recipe — multi-section imports keep all steps on section[0], so
          // showing "no instructions" under every other section is noise.
          const showEmptyInstructions =
            !html && recipe.sections.length === 1;
          return (
            <section key={section.id}>
              {section.title ? (
                <h2 className="mb-4 text-xl font-semibold tracking-tight text-[var(--color-fg)]">
                  {section.title}
                </h2>
              ) : null}
              {html || showEmptyInstructions ? (
                <div className="grid gap-8 lg:grid-cols-[20rem_1fr]">
                  <aside>{ingredientList}</aside>
                  <article>
                    {html ? (
                      <div
                        className="markdown text-[var(--color-fg)]"
                        dangerouslySetInnerHTML={{ __html: html }}
                      />
                    ) : (
                      <p className="text-sm text-[var(--color-muted-fg)]">
                        Keine Anleitung erfasst.
                      </p>
                    )}
                  </article>
                </div>
              ) : (
                <div className="lg:max-w-[20rem]">{ingredientList}</div>
              )}
            </section>
          );
        })}
      </div>
      </div>
    </AppShell>
  );
}
