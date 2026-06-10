import type { CatalogBlockIndex, IngredientCatalog } from "../matching";
import { lex } from "./lexer";
import { renderNote, tidyNote, type Leaf } from "./render-notes";
import { applyOptional } from "./passes/optional";
import { applyAmountUnit } from "./passes/amount-unit";
import { applyMatch } from "./passes/match-ingredient";

/** The structured result of parsing one ingredient segment (no alternatives /
 *  conjunctions yet — that's the segmentation layer). A subset of
 *  ImportedIngredient; unit-id resolution + candidate lists are layered on by
 *  the orchestrator that has the lookups. */
export type ParsedRow = {
  quantity: number | null;
  unitName: string | null;
  name: string;
  canonicalName: string | null;
  ingredientId: number | null;
  sourceName: string | null;
  notes: string | null;
  isOptional: boolean;
  fixedAmount: boolean;
  matched: boolean;
};

export type SegmentLookups = {
  knownUnitTokens: ReadonlySet<string>;
  catalog: IngredientCatalog;
  catalogIndex?: CatalogBlockIndex;
  threshold?: number;
};

/**
 * Compose a row's notes: the range expression (with its unit) leads, then the
 * verbatim remainder. e.g. "100-200 g" + "fein" → "100-200 g, fein".
 */
function assembleNotes(
  rangeExpression: string | null,
  unitName: string | null,
  rendered: string | null,
): string | null {
  const frags: string[] = [];
  if (rangeExpression) frags.push(unitName ? `${rangeExpression} ${unitName}` : rangeExpression);
  if (rendered) frags.push(rendered);
  return tidyNote(frags.join(", "));
}

/** Parse one ingredient segment into a structured row. */
export function parseSegment(source: string, lookups: SegmentLookups): ParsedRow {
  const leaves: Leaf[] = lex(source).map((t) => ({ ...t }));
  const isOptional = applyOptional(leaves);
  const { quantity, unitName, rangeExpression } = applyAmountUnit(
    source,
    leaves,
    lookups.knownUnitTokens,
  );
  const m = applyMatch(source, leaves, lookups.catalog, {
    index: lookups.catalogIndex,
    threshold: lookups.threshold,
  });
  const rendered = renderNote(source, leaves);
  const notes = assembleNotes(rangeExpression, unitName, rendered);
  return {
    quantity,
    unitName,
    name: m.name,
    canonicalName: m.canonicalName,
    ingredientId: m.ingredientId,
    sourceName: m.sourceName,
    notes,
    isOptional,
    fixedAmount: quantity === null,
    matched: m.matched,
  };
}
