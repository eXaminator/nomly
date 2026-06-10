import {
  findIngredientCandidatesFromLeaves,
  MIN_AUTO_MATCH_SCORE,
  type CatalogBlockIndex,
  type IngredientCandidateMatch,
  type IngredientCatalog,
} from "../../matching";
import type { AstCandidateToken } from "../candidate-tokens";
import type { Leaf } from "../render-notes";
import { SIZE_MODIFIERS } from "./amount-unit";

const normWord = (s: string): string => s.toLowerCase().replace(/[.,:!?]+$/, "");

/** Leading/trailing cooking-prep words that peel off a no-match name into the
 *  notes ("ground cumin" → name "cumin", note "ground"). A representative
 *  subset of the legacy PREP_LEADING_TOKENS. */
const PREP_WORDS = new Set([
  "chopped", "sliced", "diced", "grated", "minced", "halved", "quartered",
  "peeled", "rinsed", "drained", "cooked", "crushed", "melted", "softened",
  "beaten", "shredded", "ground", "soaked", "rolled", "seeded", "stemmed",
  "trimmed", "crumbled", "finely", "coarsely", "thinly", "thickly", "roughly",
  "lightly", "freshly", "well", "fresh",
  "gehackt", "geschnitten", "gewürfelt", "gerieben", "geschält", "gepresst",
  "fein", "grob", "frisch", "frische", "frischer", "heiß", "kalt", "warm",
]);

/** Usage prefixes — everything from here on is a note ("zum Bestreuen"). */
const USAGE_PREFIX = new Set(["zum", "zur", "für", "fürs", "for"]);
/** Note-boundary markers (example/abbreviation lead-ins). */
const NOTE_BOUNDARY = new Set(["bzw", "z.b", "zb", "ggf", "alternativ", "alternative"]);

/** True when `region[i]` begins a vocab tail that belongs in the notes, not the
 *  name (usage prefix, "to taste", "nach Geschmack/Belieben", note boundary). */
function isVocabBoundary(region: Leaf[], i: number): boolean {
  const w = normWord(region[i].text);
  if (USAGE_PREFIX.has(w) || NOTE_BOUNDARY.has(w)) return true;
  const next = region[i + 1] ? normWord(region[i + 1].text) : "";
  if (w === "to" && next === "taste") return true;
  if (w === "nach" && (next === "geschmack" || next === "belieben")) return true;
  return false;
}

export type MatchResult = {
  matched: boolean;
  ingredientId: number | null;
  /** Display name — the per-alias rename (when its default unit survives), else
   *  the matched alias verbatim, or the name-region text on the no-match path. */
  name: string;
  canonicalName: string | null;
  /** The original source span the matched alias replaced, when it differs from
   *  the alias (e.g. "Zwiebeln" → alias "Zwiebel"). Null otherwise. */
  sourceName: string | null;
  /** Equipment flag of the matched entry — caller ORs into isOptional. */
  isEquipment: boolean;
  /** Default unit of the matched alias entry, if any. */
  defaultUnit: { id: number; name: string } | null;
  /** All ranked matches (for the candidate-pill UI). */
  matches: IngredientCandidateMatch[];
};

const EMPTY: MatchResult = {
  matched: false,
  ingredientId: null,
  name: "",
  canonicalName: null,
  sourceName: null,
  isEquipment: false,
  defaultUnit: null,
  matches: [],
};

/**
 * Run the catalog matcher over the segment's unconsumed leaves, mark the
 * matched ingredient leaves consumed (role "ingredient"), and resolve the
 * display name exactly as the legacy `resolveIngredientForRow` does: a
 * per-alias `displayName` rename applies only while its default unit survives
 * (the line carried an amount), otherwise the alias name is kept. The matcher
 * reads the SAME leaves — each candidate token carries leafStart/leafEnd back
 * into `remainder`, so covered tokens map straight to leaves. Mutates `leaves`.
 */
export function applyMatch(
  source: string,
  leaves: Leaf[],
  catalog: IngredientCatalog,
  opts: {
    index?: CatalogBlockIndex;
    threshold?: number;
    /** Row quantity — gates the per-alias rename (see defaultUnitDropped). */
    quantity?: number | null;
    /** Resolved line unit id — the matcher's canned-vs-fresh decider. */
    lineUnitId?: number | null;
  } = {},
): MatchResult {
  const remainder = leaves.filter((l) => !l.consumed);
  const threshold = opts.threshold ?? MIN_AUTO_MATCH_SCORE;
  const { matches } = findIngredientCandidatesFromLeaves(remainder, catalog, {
    index: opts.index,
    gateScore: threshold,
    lineUnitId: opts.lineUnitId ?? null,
  });
  const best = matches[0];
  if (!best || best.score < threshold) return noMatch(source, remainder);

  const tokens = best.candidate as AstCandidateToken[];
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = -1;
  for (const ti of best.coveredCandidateTokens) {
    const tok = tokens[ti];
    if (!tok) continue;
    for (let li = tok.leafStart; li <= tok.leafEnd; li++) {
      remainder[li].consumed = true;
      remainder[li].role = "ingredient";
    }
    minStart = Math.min(minStart, remainder[tok.leafStart].start);
    maxEnd = Math.max(maxEnd, remainder[tok.leafEnd].end);
  }

  // Per-alias rename only makes sense with the default unit it pairs with; when
  // the line has no amount that unit is dropped (see pickFinalUnit), so keep the
  // alias name then.
  const quantity = opts.quantity ?? null;
  const defaultUnitDropped =
    best.defaultUnit != null && !(quantity !== null && quantity > 0);
  const name =
    !defaultUnitDropped && best.displayName?.trim()
      ? best.displayName.trim()
      : best.aliasName;
  const canonicalName =
    name.toLowerCase() === best.canonicalName.toLowerCase() ? null : best.canonicalName;
  let sourceName: string | null = null;
  if (maxEnd > 0) {
    const span = source.slice(minStart, maxEnd).trim();
    if (span.length > 0 && span.toLowerCase() !== name.toLowerCase()) sourceName = span;
  }
  return {
    matched: true,
    ingredientId: best.ingredientId,
    name,
    canonicalName,
    sourceName,
    isEquipment: best.isEquipment ?? false,
    defaultUnit: best.defaultUnit ?? null,
    matches,
  };
}

/**
 * No catalog hit: the name is the core depth-0 word/number run up to the first
 * top-level comma, with leading size modifiers and a trailing vocab phrase
 * ("to taste", "zum Bestreuen") left UNCONSUMED so they fall into the notes —
 * mirroring the legacy no-match name (stripVocabTail + size peel).
 */
function noMatch(source: string, remainder: Leaf[]): MatchResult {
  // Depth-0 word/number leaves before the first top-level comma (paren content
  // is skipped, not a boundary, so "(225g) large shrimp" still finds "shrimp").
  const region: Leaf[] = [];
  for (const lf of remainder) {
    if (lf.kind === "comma" && lf.depth === 0) break;
    if (lf.depth !== 0) continue;
    if (lf.kind === "word" || lf.kind === "number") region.push(lf);
  }
  const strippable = (lf: Leaf): boolean =>
    lf.kind === "word" &&
    (SIZE_MODIFIERS.has(normWord(lf.text)) || PREP_WORDS.has(normWord(lf.text)));

  let start = 0;
  let end = region.length;
  // Peel leading size/prep words ("large", "ground") — they stay in notes.
  while (start < end && strippable(region[start])) start += 1;
  // Cut a trailing vocab phrase ("to taste", "zum X") into the notes.
  for (let i = start; i < end; i++) {
    if (isVocabBoundary(region, i)) {
      end = i;
      break;
    }
  }
  // Peel trailing size/prep words ("onion chopped" → name "onion").
  while (end > start && strippable(region[end - 1])) end -= 1;
  const nameLeaves = region.slice(start, end);
  if (nameLeaves.length === 0) return EMPTY;
  for (const lf of nameLeaves) {
    lf.consumed = true;
    lf.role = "ingredient";
  }
  const name = source
    .slice(nameLeaves[0].start, nameLeaves[nameLeaves.length - 1].end)
    .trim();
  return { matched: false, ingredientId: null, name, canonicalName: null, sourceName: null };
}
