import { Fragment } from "react";
import Link from "next/link";
import {
  Clock,
  Copy,
  CornerDownRight,
  ExternalLink,
  Lock,
  Pencil,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DietBadge } from "@/components/recipes/diet-badge";
import { DietMarker } from "@/components/recipes/diet-marker";
import { NeedsUpdateToggle } from "@/components/recipes/needs-update-toggle";
import { FavoriteToggle } from "@/components/recipes/favorite-toggle";
import { IngredientLine } from "@/components/recipes/ingredient-line";
import { buildIngredientMentions } from "@/components/recipes/ingredient-mentions";
import { InstructionBody } from "@/components/recipes/instruction-body";
import { displayAmount } from "@/components/recipes/ingredient-read-line";
import {
  UpcomingUsesButton,
  UpcomingUsesProvider,
} from "@/components/recipes/ingredient-upcoming-uses";
import { cn } from "@/lib/cn";
import { isOptionalIngredient } from "@/lib/recipes/optional";
import type { RecipeView } from "@/lib/recipes/types";
import { highlightIngredientMentions, renderMarkdown } from "@/lib/markdown";

/**
 * Fixed-amount lock marker. Its own always-present column (same `h-[1lh] w-3`
 * slot as {@link DietMarker} and the upcoming-uses button) so the columns line
 * up across rows whether or not a row is amount-locked.
 */
function FixedAmountMarker({ fixed }: { fixed: boolean }) {
  return (
    <span
      className="inline-flex h-[1lh] w-3 shrink-0 items-center justify-center"
      aria-hidden={fixed ? undefined : "true"}
    >
      {fixed ? (
        <Lock className="size-3" aria-label="Feste Menge" />
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
  chosenIngredientIds,
  showEdit,
  showTitle = true,
}: {
  recipe: RecipeView;
  mealPlanId: number | null;
  /** When viewing the recipe for a specific meal (`?meal=`), the set of
   *  recipe-ingredient ids this meal actually put on the shopping list. Within
   *  an alternative group that has any chosen member, the chosen row(s) are
   *  emphasized and the others muted, so the picked alternative is obvious.
   *  Undefined (no meal context / meal not on the list) leaves the default
   *  rendering untouched. */
  chosenIngredientIds?: Set<number>;
  showEdit: boolean;
  /** When false, the recipe-name heading is hidden — used by the embed view
   *  where the surrounding chrome (e.g. the HA popup header) already shows it. */
  showTitle?: boolean;
}) {
  // The description gets the same ingredient underlines + tooltips as the
  // instructions. It isn't scoped to a section, so it matches against EVERY
  // section's ingredients — which is also the set a partial match has to be
  // unambiguous within.
  const descriptionMentions = buildIngredientMentions(
    recipe.sections.flatMap((s) => s.ingredients),
  );
  const renderedDescription = renderMarkdown(recipe.description);
  const descriptionHtml = renderedDescription
    ? highlightIngredientMentions(
        renderedDescription,
        descriptionMentions.mentions,
      )
    : null;

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
          {/* The needs-update toggle renders everywhere — including the
              embed/iframe view, whose allow-list permits exactly this one
              write. Only the edit link is gated by `showEdit`. */}
          <div className="flex shrink-0 flex-wrap gap-2">
            <FavoriteToggle recipeId={recipe.id} initial={recipe.isFavorite} />
            <NeedsUpdateToggle
              recipeId={recipe.id}
              initial={recipe.needsUpdate}
            />
            {showEdit ? (
              <>
                <Button asChild variant="outline">
                  <Link href={`/rezepte/${recipe.id}/kopieren`}>
                    <Copy className="size-4" />
                    Kopieren
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href={`/rezepte/${recipe.id}/bearbeiten`}>
                    <Pencil className="size-4" />
                    Bearbeiten
                  </Link>
                </Button>
              </>
            ) : null}
          </div>
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
          <InstructionBody
            html={descriptionHtml}
            tips={descriptionMentions.tips}
            className="markdown mt-6 text-[var(--color-fg)]"
          />
        ) : null}

        <div className="mt-8 space-y-12">
          {recipe.sections.map((section) => {
            const consumables = section.ingredients.filter((i) => !i.isEquipment);
            const equipment = section.ingredients.filter((i) => i.isEquipment);
            // Underline mentions of this section's food ingredients in the
            // instructions, with the full list line (colors + diet icon) shown
            // as a hover/tap tooltip by <InstructionBody>. Spellings, grouping
            // and the partial-match rules all live in
            // {@link buildIngredientMentions}; ambiguity is judged per section,
            // so "Linsen" resolves to this section's lentils only.
            const { mentions: ingredientMentions, tips: mentionTips } =
              buildIngredientMentions(section.ingredients);
            const rendered = renderMarkdown(section.instructions);
            const html = rendered
              ? highlightIngredientMentions(rendered, ingredientMentions)
              : rendered;

            type IngredientRow = (typeof section.ingredients)[number];

            const renderIngredient = (
              ing: IngredientRow,
              asAlternative = false,
              // Within an alternative group that this meal chose from:
              // "chosen" = added to the shopping list (emphasized), "muted" =
              // not added (faded harder than the default optional dimming).
              // "default" = no meal decision applies, render as usual.
              emphasis: "chosen" | "muted" | "default" = "default",
            ) => {
              // "Nicht zugeordnet": pure-text line with no article. Rendered
              // as optional (free-text lines are garnish/leftover-style
              // suggestions) and without the qty/unit column — the text
              // starts where the amount would.
              const unassigned = ing.ingredientId == null;
              return (
              <li
                key={ing.id}
                // `items-start` keeps the qty/unit column anchored to the
                // top when a long ingredient name + notes wraps onto a
                // second line. Alternatives go through `isOptionalIngredient`
                // so they share the same dimmed treatment as explicit
                // optionals (italic + 65% opacity). When this meal picked from
                // the group, the chosen row is un-dimmed + emphasized and the
                // rest are muted further, overriding the default treatment.
                className={cn(
                  "flex items-start gap-2",
                  emphasis === "chosen"
                    ? "font-medium text-[var(--color-fg)]"
                    : emphasis === "muted"
                      ? "italic opacity-40"
                      : (isOptionalIngredient(ing) || unassigned) &&
                          "italic opacity-65",
                )}
              >
                <UpcomingUsesButton
                  ingredientId={ing.ingredientId}
                  ingredientName={ing.canonicalIngredientName ?? ing.ingredientName}
                />
                <FixedAmountMarker fixed={ing.fixedAmount} />
                {/* Alternatives get a leading arrow column (same `h-[1lh] w-3`
                    slot as the diet marker), then their own diet marker — the
                    arrow indents the row slightly under its primary while the
                    diet icon stays visible. */}
                {asAlternative ? (
                  <span className="inline-flex h-[1lh] w-3 shrink-0 items-center justify-center">
                    <CornerDownRight
                      className="size-3 text-[var(--color-muted-fg)]"
                      aria-hidden="true"
                    />
                  </span>
                ) : null}
                {/* Equipment gets no marker at all; food rows with no
                    classification (including unlinked lines) show the
                    muted "unknown" question mark. */}
                <DietMarker kind={ing.isEquipment ? "none" : ing.dietaryClass} />
                {/* Unassigned lines have no amount/unit by definition — skip
                    the column entirely so the text starts at the amount
                    column instead of being indented past it. */}
                {unassigned ? null : (
                  <span className="inline-flex min-w-12 shrink-0 items-center font-mono text-[var(--color-muted-fg)]">
                    {displayAmount({ quantity: ing.quantity, quantityLow: ing.quantityLow, quantifierName: ing.quantifierName, quantifierValue: ing.quantifierValue, quantifierSource: ing.quantifierSource }, { fraction: ing.displayFraction })}{" "}
                    {ing.unitLabel ?? ""}
                  </span>
                )}
                <span className="flex-1">
                  <IngredientLine
                    displayName={ing.ingredientName}
                    canonicalName={ing.canonicalIngredientName}
                  />
                  {ing.notes ? (
                    <span className="text-[var(--color-muted-fg)]"> – {ing.notes}</span>
                  ) : null}
                  {/* Unassigned lines are only *styled* as optional — the
                      literal "(optional)" suffix stays reserved for rows
                      explicitly flagged optional. */}
                  {!asAlternative && isOptionalIngredient(ing) ? (
                    <span className="ml-1 text-xs text-[var(--color-muted-fg)]">
                      (optional)
                    </span>
                  ) : null}
                </span>
              </li>
              );
            };

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
                {groupByPrimary(rows).map(({ primary, alternatives }) => {
                  // A group is "decided" only when it has alternatives AND this
                  // meal put at least one of the group's rows on the shopping
                  // list. Then chosen rows are emphasized and the rest muted;
                  // otherwise every row renders with its default treatment.
                  const members = [primary, ...alternatives];
                  const decided =
                    chosenIngredientIds != null &&
                    alternatives.length > 0 &&
                    members.some((m) => chosenIngredientIds.has(m.id));
                  const emphasisFor = (
                    m: IngredientRow,
                  ): "chosen" | "muted" | "default" =>
                    !decided
                      ? "default"
                      : chosenIngredientIds!.has(m.id)
                        ? "chosen"
                        : "muted";
                  return (
                    <Fragment key={primary.id}>
                      {renderIngredient(primary, false, emphasisFor(primary))}
                      {alternatives.map((alt) =>
                        renderIngredient(alt, true, emphasisFor(alt)),
                      )}
                    </Fragment>
                  );
                })}
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
                        <InstructionBody html={html} tips={mentionTips} />
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
