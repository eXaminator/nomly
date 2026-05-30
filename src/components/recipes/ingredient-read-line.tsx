import { CornerDownRight, Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { IngredientLine } from "@/components/recipes/ingredient-line";

/** Display formatting for an ingredient quantity (de-DE, ≤2 decimals). */
export function formatQuantity(q: number | null): string {
  if (q === null) return "";
  const rounded = Math.round(q * 100) / 100;
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(
    rounded,
  );
}

export type ReadLineProps = {
  quantity: number | null;
  unitLabel: string | null;
  name: string;
  canonicalName: string | null;
  notes: string | null;
  isOptional: boolean;
  isAlternative: boolean;
  fixedAmount?: boolean;
};

/**
 * Read-view formatting of a single recipe ingredient line — the same layout
 * the recipe detail page uses (mono quantity column, name with canonical
 * disclosure, " – notes", "(optional)", alternative arrow + "oder"). Pure
 * presentation: no per-ingredient links / diet markers, so it can be reused
 * wherever an ingredient line needs to read like the recipe view (e.g. the
 * bulk re-parse diff).
 */
export function RecipeIngredientReadLine({
  quantity,
  unitLabel,
  name,
  canonicalName,
  notes,
  isOptional,
  isAlternative,
  fixedAmount = false,
}: ReadLineProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-2",
        (isOptional || isAlternative) && "italic opacity-65",
      )}
    >
      {isAlternative ? (
        <CornerDownRight
          className="mt-0.5 size-4 shrink-0 text-[var(--color-muted-fg)]"
          aria-hidden="true"
        />
      ) : null}
      <span className="inline-flex min-w-12 shrink-0 items-center gap-1 font-mono text-[var(--color-muted-fg)]">
        {fixedAmount ? (
          <Lock className="size-3 shrink-0" aria-label="Feste Menge" />
        ) : null}
        <span>
          {formatQuantity(quantity)} {unitLabel ?? ""}
        </span>
      </span>
      <span className="flex-1">
        {isAlternative ? <span>oder </span> : null}
        <IngredientLine displayName={name} canonicalName={canonicalName} />
        {notes ? (
          <span className="text-[var(--color-muted-fg)]"> – {notes}</span>
        ) : null}
        {!isAlternative && isOptional ? (
          <span className="ml-1 text-xs text-[var(--color-muted-fg)]">
            (optional)
          </span>
        ) : null}
      </span>
    </div>
  );
}
