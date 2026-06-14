import { pluralizeLabel } from "@/lib/units/label";
import type { UnitForm } from "@/lib/recipes/reparse-scan";

/**
 * Inflect a unit label by quantity, using the catalog's known forms. Given any
 * label — a singular, a plural, the canonical name, or an alias — it resolves
 * to that form's pair and returns the quantity-correct spelling via the shared
 * {@link pluralizeLabel} rule (plural for >1 or an unspecified/null amount,
 * singular for exactly 1 and partials below 1, and only when a plural is
 * configured). A label the catalog doesn't know (free text) is returned
 * verbatim, since we have no forms to inflect it with.
 *
 * The bulk-reparse diff uses this for BOTH rendering and change detection:
 * inflecting both sides by their own quantity makes a pure singular/plural
 * difference collapse to the same string (so it never highlights), while a
 * genuine unit/alias change still differs.
 */
export type UnitInflector = (
  label: string | null,
  quantity: number | null,
) => string | null;

export function buildUnitInflector(forms: UnitForm[]): UnitInflector {
  const byToken = new Map<string, { singular: string; plural: string | null }>();
  const add = (singular: string, plural: string | null) => {
    const pair = { singular, plural };
    byToken.set(singular.toLowerCase(), pair);
    if (plural) byToken.set(plural.toLowerCase(), pair);
  };
  for (const f of forms) {
    add(f.name, f.plural);
    for (const a of f.aliases) add(a.name, a.plural);
  }
  return (label, quantity) => {
    if (label == null) return null;
    const pair = byToken.get(label.trim().toLowerCase());
    if (!pair) return label; // free text — keep the user's spelling verbatim
    return pluralizeLabel({ name: pair.singular, plural: pair.plural }, quantity);
  };
}
