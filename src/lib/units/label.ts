/**
 * Singular/plural display logic for units and their aliases.
 *
 * The rule across the app: a configured plural is used for any amount *other
 * than 1*; amount 1 (and a missing amount) uses the singular. The label shown
 * for a recipe line is whichever label was *matched* during import — the
 * canonical unit or one of its aliases — so each can carry its own plural.
 *
 * This module is pure (no DB) so it can be unit-tested and reused by both the
 * recipe read view and the shopping-list display.
 */

/** A single label with its optional plural form. */
export type LabelForm = {
  name: string;
  plural: string | null;
};

/** A canonical unit plus every alias, each with its own optional plural. */
export type UnitLabelInfo = LabelForm & {
  aliases: LabelForm[];
};

/**
 * Pick the singular or plural form of a label for a given amount. Plural wins
 * only when one is configured AND the quantity is neither 1 nor null.
 */
export function pluralizeLabel(form: LabelForm, quantity: number | null): string {
  if (form.plural && quantity !== null && quantity !== 1) return form.plural;
  return form.name;
}

function matchesForm(form: LabelForm, token: string): boolean {
  if (form.name.toLowerCase() === token) return true;
  return form.plural != null && form.plural.toLowerCase() === token;
}

/**
 * Resolve the unit label to show for a recipe line, honouring the matched
 * label's own singular/plural.
 *
 * - The label is the canonical unit, unless `displayUnit` names a specific
 *   alias (or the canonical) — then that matched label drives both forms, so
 *   the amount picks singular vs plural even if `displayUnit` preserved the
 *   opposite spelling.
 * - A `displayUnit` that matches no known label is free text and is shown
 *   verbatim (never pluralized — we don't know its forms).
 * - Returns null when the line has no unit or displayUnit at all.
 */
export function resolveUnitLabel(opts: {
  unit: UnitLabelInfo | null;
  displayUnit: string | null;
  quantity: number | null;
}): string | null {
  const { unit, displayUnit, quantity } = opts;

  if (unit) {
    if (!displayUnit) return pluralizeLabel(unit, quantity);
    const token = displayUnit.toLowerCase();
    if (matchesForm(unit, token)) return pluralizeLabel(unit, quantity);
    for (const alias of unit.aliases) {
      if (matchesForm(alias, token)) return pluralizeLabel(alias, quantity);
    }
    // Free text the unit doesn't know about — keep the user's spelling as-is.
    return displayUnit;
  }

  return displayUnit ?? null;
}
