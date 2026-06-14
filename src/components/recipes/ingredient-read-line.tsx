import { Fragment, type ReactNode } from "react";
import { CornerDownRight, Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { IngredientLine } from "@/components/recipes/ingredient-line";
import { toFractionDisplay } from "@/lib/units/fraction";
import type { NotesDiffSegment } from "@/components/recipes/notes-diff";

/**
 * Display formatting for an ingredient quantity (de-DE, ≤2 decimals). When
 * `fraction` is set (the line's unit is flagged for fraction display), a value
 * that resolves to a clean fraction renders as one ("1/4", "1 1/2"); anything
 * else falls back to the decimal format.
 */
export function formatQuantity(
  q: number | null,
  opts?: { fraction?: boolean },
): string {
  if (q === null) return "";
  if (opts?.fraction) {
    const fraction = toFractionDisplay(q);
    if (fraction !== null) return fraction;
  }
  const rounded = Math.round(q * 100) / 100;
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(
    rounded,
  );
}

/**
 * Format an amount or a low–high range for display. Each bound goes through
 * {@link formatQuantity} (so fraction formatting applies to both), joined by an
 * en-dash. Returns "" when there is no high quantity; a low bound without a high
 * is ignored.
 */
export function formatAmount(
  quantity: number | null,
  quantityLow: number | null,
  opts?: { fraction?: boolean },
): string {
  const high = formatQuantity(quantity, opts);
  if (quantityLow == null || quantity == null) return high;
  return `${formatQuantity(quantityLow, opts)}–${high}`;
}

/**
 * Determine the effective display string for an ingredient amount, taking
 * quantifiers into account:
 * - If `quantity` is set, it (and any `quantityLow`) format as a normal
 *   amount/range.
 * - If `quantity` is null but `quantifierValue` is set, the quantifier's
 *   numeric value is used as the effective high bound.
 * - If both are null but `quantifierName` is set, the name is returned
 *   verbatim ("einige").
 * - Otherwise returns "".
 */
export function displayAmount(
  a: {
    quantity: number | null;
    quantityLow?: number | null;
    quantifierName?: string | null;
    quantifierValue?: number | null;
  },
  opts?: { fraction?: boolean },
): string {
  const effHigh = a.quantity ?? a.quantifierValue ?? null;
  if (effHigh != null) return formatAmount(effHigh, a.quantityLow ?? null, opts);
  if (a.quantifierName) return a.quantifierName;
  return "";
}

/** Which fields differ from the other side of a diff — used to color-highlight
 *  the changed parts. */
export type LineHighlight = {
  amount?: boolean;
  name?: boolean;
  notes?: boolean;
  mapping?: boolean;
  /** The optional/required flag differs between the two sides. Tints the
   *  "(optional)" chip — red on the side that loses it (becomes mandatory),
   *  green on the side that gains it (becomes optional), like every other diff. */
  optional?: boolean;
  /** The alternative/main flag differs. Tints the alternative indent icon —
   *  red on the side that loses it (becomes a main ingredient), green on the
   *  side that gains it (becomes an alternative). */
  alternative?: boolean;
};

export type ReadLineProps = {
  quantity: number | null;
  /** Low bound of an amount range, else null → renders "low–high". */
  quantityLow?: number | null;
  /** Name of the quantifier ("einige"), displayed verbatim when no numeric
   *  amount is available. */
  quantifierName?: string | null;
  /** Numeric value of the quantifier — used as the effective amount when
   *  `quantity` is null. */
  quantifierValue?: number | null;
  unitLabel: string | null;
  /** When true, the line's unit is flagged for fraction display; the quantity
   *  renders as a fraction when it resolves to one. */
  displayFraction?: boolean;
  name: string;
  canonicalName: string | null;
  notes: string | null;
  isOptional: boolean;
  isAlternative: boolean;
  fixedAmount?: boolean;
  /** When provided, render an explicit "→ <ingredient>" mapping chip after the
   *  line so the resolved catalog ingredient is visible (used by the bulk
   *  re-parse diff to confirm the mapping). Omit for the plain read view. */
  mappingLabel?: string | null;
  /** Per-field change flags; the flagged fields get a colored highlight.
   *  `tone` picks the color: "removed" (old/current side, red) vs "added"
   *  (new/proposed side, green). */
  highlight?: LineHighlight;
  tone?: "removed" | "added";
  /** Strike the whole line through — used on the PROPOSED side for a row that
   *  won't exist after applying (a carried alternative being deleted), so it
   *  reads as "going away" rather than a green/red change. */
  struck?: boolean;
  /** Word-level diff segments for THIS side's notes (see diffNotes). When
   *  provided (and the notes are flagged changed), only the changed words
   *  are tinted instead of the whole notes string. */
  notesDiff?: NotesDiffSegment[];
};

/**
 * Read-view formatting of a single recipe ingredient line — the same layout
 * the recipe detail page uses (mono quantity column, name with canonical
 * disclosure, " – notes", "(optional)", alternative arrow). Pure
 * presentation: no per-ingredient links / diet markers, so it can be reused
 * wherever an ingredient line needs to read like the recipe view (e.g. the
 * bulk re-parse diff).
 */
export function RecipeIngredientReadLine({
  quantity,
  quantityLow = null,
  quantifierName = null,
  quantifierValue = null,
  unitLabel,
  displayFraction = false,
  name,
  canonicalName,
  notes,
  isOptional,
  isAlternative,
  fixedAmount = false,
  mappingLabel,
  highlight,
  tone,
  struck = false,
  notesDiff,
}: ReadLineProps) {
  // Subtle tint: green for the new/proposed side, red for the old/current side.
  const hlClass =
    tone === "added"
      ? "rounded bg-[color-mix(in_srgb,#22c55e,transparent_75%)] px-0.5"
      : // Dark mode uses a pure, saturated red (not a washed-out pink) so the
        // removed-side highlight reads as brighter, not grayer.
        "rounded bg-[color-mix(in_srgb,#ef4444,transparent_80%)] px-0.5 dark:bg-[#ff000099]";
  const mark = (on: boolean | undefined, node: ReactNode) =>
    on && tone ? <span className={hlClass}>{node}</span> : node;
  return (
    <div
      className={cn(
        "flex items-start gap-2",
        (isOptional || isAlternative) && "italic opacity-65",
        // Strike the WHOLE row. line-through on the flex container doesn't reach
        // blockified flex items / inline-block children (name, notes, mapping
        // chip), so force it on every descendant too.
        struck &&
          "text-[var(--color-muted-fg)] line-through opacity-65 [&_*]:line-through",
      )}
    >
      {isAlternative ? (
        <span
          className={cn(
            "mt-0.5 shrink-0",
            highlight?.alternative && tone ? hlClass : undefined,
          )}
        >
          <CornerDownRight
            className="size-4 text-[var(--color-muted-fg)]"
            aria-hidden="true"
          />
        </span>
      ) : null}
      <span className="inline-flex min-w-12 shrink-0 items-center gap-1 font-mono text-[var(--color-muted-fg)]">
        {fixedAmount ? (
          <Lock className="size-3 shrink-0" aria-label="Feste Menge" />
        ) : null}
        {mark(
          highlight?.amount,
          <span>
            {displayAmount({ quantity, quantityLow, quantifierName, quantifierValue }, { fraction: displayFraction })}{" "}
            {unitLabel ?? ""}
          </span>,
        )}
      </span>
      <span className="flex-1">
        {mark(
          highlight?.name,
          <IngredientLine displayName={name} canonicalName={canonicalName} />,
        )}
        {notes ? (
          highlight?.notes && tone && notesDiff && notesDiff.length > 0 ? (
            // Granular notes diff: tint only the changed words.
            <span className="text-[var(--color-muted-fg)]">
              {" "}
              –{" "}
              {notesDiff.map((seg, k) => (
                <Fragment key={k}>
                  {k > 0 ? " " : null}
                  {seg.changed ? (
                    <span className={hlClass}>{seg.text}</span>
                  ) : (
                    seg.text
                  )}
                </Fragment>
              ))}
            </span>
          ) : (
            mark(
              highlight?.notes,
              <span className="text-[var(--color-muted-fg)]"> – {notes}</span>,
            )
          )
        ) : null}
        {!isAlternative && isOptional ? (
          <span
            className={cn(
              "ml-1 text-xs text-[var(--color-muted-fg)]",
              highlight?.optional && tone ? hlClass : undefined,
            )}
          >
            (optional)
          </span>
        ) : null}
        {mappingLabel !== undefined ? (
          <span
            className={cn(
              "ml-1 inline-block whitespace-nowrap rounded-full px-1.5 py-0.5 align-middle text-xs not-italic",
              highlight?.mapping && tone
                ? hlClass + " text-[var(--color-fg)]"
                : "bg-[var(--color-muted)] text-[var(--color-muted-fg)]",
            )}
          >
            → {mappingLabel ?? "nicht zugeordnet"}
          </span>
        ) : null}
      </span>
    </div>
  );
}
