import { Fragment } from "react";
import Link from "next/link";
import {
  Beef,
  Clock,
  CornerDownRight,
  ExternalLink,
  Leaf,
  Lock,
  Pencil,
  Salad,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DietBadge } from "@/components/recipes/diet-badge";
import { IngredientLine } from "@/components/recipes/ingredient-line";
import {
  UpcomingUsesButton,
  UpcomingUsesProvider,
} from "@/components/recipes/ingredient-upcoming-uses";
import { cn } from "@/lib/cn";
import { isOptionalIngredient } from "@/lib/recipes/optional";
import type { IngredientDietaryClass } from "@/lib/recipes/diet";
import type { RecipeView } from "@/lib/recipes/types";
import { renderMarkdown } from "@/lib/markdown";

function formatQuantity(q: number | null): string {
  if (q === null) return "";
  const rounded = Math.round(q * 100) / 100;
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(rounded);
}

function DietMarker({ kind }: { kind: IngredientDietaryClass }) {
  // Fixed-width slot, height-stretch so the icon is vertically centered in
  // the line — keeps the amount column aligned whether or not a marker shows.
  // Color-only signal; labels are kept in `title` for screen readers.
  return (
    <span
      className="inline-flex w-3 shrink-0 items-center justify-center"
      aria-hidden={kind == null ? "true" : undefined}
    >
      {kind === "vegan" ? (
        <Leaf className="size-3" style={{ color: "var(--color-success)" }}>
          <title>vegan</title>
        </Leaf>
      ) : kind === "vegetarian" ? (
        <Salad className="size-3" style={{ color: "var(--color-warning)" }}>
          <title>vegetarisch</title>
        </Salad>
      ) : kind === "meat" ? (
        <Beef className="size-3" style={{ color: "var(--color-danger)" }}>
          <title>tierisch</title>
        </Beef>
      ) : null}
    </span>
  );
}

/**
 * The recipe body — title, meta, photo, ingredients and instructions.
 * Shared by the full recipe page (`showEdit`) and the chrome-less embed view
 * used by the Home Assistant iframe (`showEdit={false}`, `mealPlanId={null}`).
 */
export function RecipeDetail({
  recipe,
  mealPlanId,
  showEdit,
  showTitle = true,
}: {
  recipe: RecipeView;
  mealPlanId: number | null;
  showEdit: boolean;
  /** When false, the recipe-name heading is hidden — used by the embed view
   *  where the surrounding chrome (e.g. the HA popup header) already shows it. */
  showTitle?: boolean;
}) {
  const descriptionHtml = renderMarkdown(recipe.description);

  return (
    <UpcomingUsesProvider mealPlanId={mealPlanId}>
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1">
            {showTitle ? (
              <h1 className="text-3xl font-semibold tracking-tight">{recipe.title}</h1>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-[var(--color-muted-fg)]">
              <DietBadge
                isVegan={recipe.isVegan}
                isVegetarian={recipe.isVegetarian}
                confidence={recipe.dietConfidence}
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
          {showEdit ? (
            <Button asChild variant="outline">
              <Link href={`/rezepte/${recipe.id}/bearbeiten`}>
                <Pencil className="size-4" />
                Bearbeiten
              </Link>
            </Button>
          ) : null}
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

            type IngredientRow = (typeof section.ingredients)[number];

            const renderIngredient = (
              ing: IngredientRow,
              asAlternative = false,
            ) => (
              <li
                key={ing.id}
                // `items-start` keeps the qty/unit column anchored to the
                // top when a long ingredient name + notes wraps onto a
                // second line. Alternatives go through `isOptionalIngredient`
                // so they share the same dimmed treatment as explicit
                // optionals (italic + 65% opacity).
                className={cn(
                  "flex items-start gap-2",
                  isOptionalIngredient(ing) && "italic opacity-65",
                )}
              >
                {asAlternative ? (
                  <CornerDownRight
                    className="size-4 shrink-0 text-[var(--color-muted-fg)]"
                    aria-hidden="true"
                  />
                ) : null}
                <UpcomingUsesButton
                  ingredientId={ing.ingredientId}
                  ingredientName={ing.canonicalIngredientName ?? ing.ingredientName}
                />
                <DietMarker kind={ing.isEquipment ? null : ing.dietaryClass} />
                <span className="inline-flex min-w-12 items-center gap-1 font-mono text-[var(--color-muted-fg)]">
                  {ing.fixedAmount ? (
                    <Lock className="size-3 shrink-0" aria-label="Feste Menge" />
                  ) : null}
                  <span>
                    {formatQuantity(ing.quantity)} {ing.unitName ?? ""}
                  </span>
                </span>
                <span className="flex-1">
                  {asAlternative ? <span>oder </span> : null}
                  <IngredientLine
                    displayName={ing.ingredientName}
                    canonicalName={ing.canonicalIngredientName}
                  />
                  {ing.notes ? (
                    <span className="text-[var(--color-muted-fg)]"> – {ing.notes}</span>
                  ) : null}
                  {!asAlternative && isOptionalIngredient(ing) ? (
                    <span className="ml-1 text-xs text-[var(--color-muted-fg)]">
                      (optional)
                    </span>
                  ) : null}
                </span>
              </li>
            );

            // Group consecutive alternative rows under their preceding
            // non-alternative primary. The service layer already returns
            // ingredients in sortOrder, so alternatives sit directly after
            // their primary in the array.
            const groupByPrimary = (
              rows: IngredientRow[],
            ): { primary: IngredientRow; alternatives: IngredientRow[] }[] => {
              const out: {
                primary: IngredientRow;
                alternatives: IngredientRow[];
              }[] = [];
              for (const row of rows) {
                if (row.alternativeForId != null && out.length > 0) {
                  out[out.length - 1].alternatives.push(row);
                } else {
                  out.push({ primary: row, alternatives: [] });
                }
              }
              return out;
            };

            const renderList = (rows: IngredientRow[]) => (
              <ul className="space-y-1 text-sm text-[var(--color-fg)]">
                {groupByPrimary(rows).map(({ primary, alternatives }) => (
                  <Fragment key={primary.id}>
                    {renderIngredient(primary)}
                    {alternatives.map((alt) => renderIngredient(alt, true))}
                  </Fragment>
                ))}
              </ul>
            );

            const ingredientList = (
              <div className="space-y-4">
                {renderList(consumables)}
                {equipment.length > 0 ? (
                  <div className="space-y-1">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-fg)]">
                      Du brauchst auch
                    </h3>
                    {renderList(equipment)}
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
    </UpcomingUsesProvider>
  );
}
