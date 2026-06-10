import type {
  CatalogBlockIndex,
  IngredientCatalog,
} from "../matching";
import type { ImportedCandidateMatch, ImportedNameProposal } from "../index";
import type { HighlightPart } from "../source-ranges";
import { lex } from "./lexer";
import { renderNote, tidyNote, type Leaf } from "./render-notes";
import { renderHighlights } from "./render-highlights";
import { applyOptional } from "./passes/optional";
import { applyPluralMarkers } from "./passes/plural-marker";
import { applyPrepNoun } from "./passes/prep-noun";
import { applyAmountUnit } from "./passes/amount-unit";
import { applyColonAmount } from "./passes/colon-amount";
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
  isEquipment: boolean;
  defaultUnit: { id: number; name: string } | null;
  candidateMatches: ImportedCandidateMatch[];
  newNameProposals: ImportedNameProposal[];
  /** Categorised highlight spans for the row's own segment, relative to the
   *  piece source (the caller rebases onto the full line). */
  highlightParts: HighlightPart[];
};

export type SegmentLookups = {
  knownUnitTokens: ReadonlySet<string>;
  catalog: IngredientCatalog;
  catalogIndex?: CatalogBlockIndex;
  threshold?: number;
  /** Resolve the line's unit id from its (raw) name + quantity — the matcher's
   *  canned-vs-fresh decider. Injected by the caller (closure over the unit
   *  lookup) to avoid an index.ts import cycle. */
  lineUnitId?: (unitName: string | null, quantity: number | null) => number | null;
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
  if (!rangeExpression) return rendered;
  const rangeFrag = unitName ? `${rangeExpression} ${unitName}` : rangeExpression;
  if (!rendered) return tidyNote(rangeFrag);
  // With a unit the range reads as a measurement ("2-3 cups, for frying" —
  // comma); without one it glues to a trailing modifier ("5-6 große").
  const sep = unitName ? ", " : " ";
  return tidyNote(`${rangeFrag}${sep}${rendered}`);
}

/** Parse one ingredient segment into a structured row. The lexer runs over the
 *  ORIGINAL source exactly once; every transformation (plural markers, colon
 *  amount, decimal glue) is an in-place AST annotation, never a source rewrite,
 *  so leaf offsets stay faithful to the input. */
export function parseSegment(source: string, lookups: SegmentLookups): ParsedRow {
  const leaves: Leaf[] = lex(source).map((t) => ({ ...t }));
  // Annotate (don't rewrite) inline plural markers "Tomate(n)" → dropped.
  applyPluralMarkers(leaves);
  const isOptional = applyOptional(leaves);
  // Prep noun ("Juice of …") runs before the amount pass so the quantity that
  // follows the dropped connector is still found; its text leads the notes.
  const prepNote = applyPrepNoun(leaves);
  // The inverted "Name: qty unit" form extracts its amount from after the colon
  // in place; otherwise the normal leading-amount pass runs.
  const { quantity, unitName, rangeExpression } =
    applyColonAmount(source, leaves, lookups.knownUnitTokens) ??
    applyAmountUnit(source, leaves, lookups.knownUnitTokens);
  const m = applyMatch(source, leaves, lookups.catalog, {
    index: lookups.catalogIndex,
    threshold: lookups.threshold,
    quantity,
    lineUnitId: lookups.lineUnitId?.(unitName, quantity) ?? null,
  });
  const rendered = renderNote(source, leaves);
  const baseNotes = assembleNotes(rangeExpression, unitName, rendered);
  const notes = prepNote
    ? tidyNote([prepNote, baseNotes].filter((s) => s != null && s.length > 0).join(", "))
    : baseNotes;
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
    isEquipment: m.isEquipment,
    defaultUnit: m.defaultUnit,
    candidateMatches: m.candidateMatches,
    // The "Aufgeräumt" proposal's notes should match the row's assembled notes
    // (range/prep prefix included), not just the bare render.
    newNameProposals: m.newNameProposals.map((p, i) =>
      i === 0 ? { ...p, notes } : p,
    ),
    // Highlights fall out of the annotated leaf roles (one source of truth).
    highlightParts: renderHighlights(source, leaves),
  };
}
