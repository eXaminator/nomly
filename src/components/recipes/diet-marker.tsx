import { Beef, CircleHelp, Leaf, Salad } from "lucide-react";
import type { IngredientDietaryClass } from "@/lib/recipes/diet";

/**
 * Per-ingredient diet marker — a fixed-width, one-line-tall slot showing a
 * color-coded icon (vegan / vegetarian / meat / unknown) or an empty
 * placeholder so columns line up across rows. Shared by the recipe ingredient
 * list and the instruction-mention tooltip so both render the identical icon.
 *
 * `null` (unknown classification — including unlinked lines, which have no
 * article) renders a muted question mark; pass `"none"` for rows where a diet
 * marker makes no sense at all (equipment) to keep the slot empty.
 *
 * The `h-[1lh]` box centers the icon on the first text line even when the
 * row's name/notes wrap (the row is `items-start`). Color-only signal; the
 * label lives in `<title>` for screen readers.
 */
export function DietMarker({
  kind,
}: {
  kind: IngredientDietaryClass | "none";
}) {
  return (
    <span
      className="inline-flex h-[1lh] w-3 shrink-0 items-center justify-center"
      aria-hidden={kind === "none" ? "true" : undefined}
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
      ) : kind === null ? (
        <CircleHelp
          className="size-3"
          style={{ color: "var(--color-muted-fg)" }}
        >
          <title>unbekannt</title>
        </CircleHelp>
      ) : null}
    </span>
  );
}
