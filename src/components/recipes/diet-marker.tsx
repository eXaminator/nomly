import { Beef, Leaf, Salad } from "lucide-react";
import type { IngredientDietaryClass } from "@/lib/recipes/diet";

/**
 * Per-ingredient diet marker — a fixed-width, one-line-tall slot showing a
 * color-coded icon (vegan / vegetarian / meat) or an empty placeholder so
 * columns line up across rows. Shared by the recipe ingredient list and the
 * instruction-mention tooltip so both render the identical icon.
 *
 * The `h-[1lh]` box centers the icon on the first text line even when the
 * row's name/notes wrap (the row is `items-start`). Color-only signal; the
 * label lives in `<title>` for screen readers.
 */
export function DietMarker({ kind }: { kind: IngredientDietaryClass }) {
  return (
    <span
      className="inline-flex h-[1lh] w-3 shrink-0 items-center justify-center"
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
