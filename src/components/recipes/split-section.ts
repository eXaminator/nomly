import { emptySection, type DraftSection } from "./types";

/**
 * Splits `sections[sectionIndex]` at `ingredientIndex`: the rows from that
 * index downward move into a fresh section (empty title/instructions, new
 * uid) inserted right after the current one. Title and instructions stay on
 * the upper half. Returns the new sections array plus the new section's uid
 * (for scroll-to-focus), or null when the boundary would leave an empty half
 * or the indices are out of range. Pure — the input is not mutated.
 */
export function splitSectionAt(
  sections: DraftSection[],
  sectionIndex: number,
  ingredientIndex: number,
): { sections: DraftSection[]; newSectionUid: string } | null {
  const source = sections[sectionIndex];
  if (!source) return null;
  if (ingredientIndex <= 0 || ingredientIndex >= source.ingredients.length) {
    return null;
  }
  const upper: DraftSection = {
    ...source,
    ingredients: source.ingredients.slice(0, ingredientIndex),
  };
  const fresh: DraftSection = {
    ...emptySection(),
    ingredients: source.ingredients.slice(ingredientIndex),
  };
  const next = [...sections];
  next.splice(sectionIndex, 1, upper, fresh);
  return { sections: next, newSectionUid: fresh.uid };
}
