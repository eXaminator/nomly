import {
  findIngredientCandidatesFromLeaves,
  MIN_AUTO_MATCH_SCORE,
  type CatalogBlockIndex,
  type IngredientCandidateMatch,
  type IngredientCatalog,
} from "../../matching";
import type { ImportedCandidateMatch, ImportedNameProposal } from "../../index";
import type { AstCandidateToken } from "../candidate-tokens";
import { renderNote, type Leaf } from "../render-notes";
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

/** Vague amount words ("etwas Öl", "some salt") — peel off a no-match name into
 *  the notes, mirroring the legacy TEXT_AMOUNT_VAGUE handling. */
const VAGUE_WORDS = new Set(["etwas", "some", "wenig", "little", "bit", "touch"]);

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
  // "z.B." / "z. B." — the lexer splits it into "z" + "b"; treat as a boundary.
  if (w === "z" && next === "b") return true;
  return false;
}

/** Leading filler words ("of caster sugar" → "caster sugar", "and Salz" →
 *  "Salz") — dropped from the no-match name entirely (not kept as notes). */
const NAME_FILLER = new Set([
  "of", "von", "vom", "and", "und", "the", "der", "die", "das", "plus", "to",
]);

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
  /** Ranked candidate pills (alias name + faithful per-candidate notes). */
  candidateMatches: ImportedCandidateMatch[];
  /** New-ingredient name proposals (no-match path only). */
  newNameProposals: ImportedNameProposal[];
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
  candidateMatches: [],
  newNameProposals: [],
};

/** Per-candidate notes: render with this candidate's covered leaves temporarily
 *  marked consumed (on top of the already-consumed amount/unit/optional), then
 *  restored — so each pill shows its own faithful remainder. */
function candidateNotes(
  source: string,
  leaves: readonly Leaf[],
  remainder: Leaf[],
  m: IngredientCandidateMatch,
): string | null {
  const tokens = m.candidate as AstCandidateToken[];
  const marked: Leaf[] = [];
  for (const ti of m.coveredCandidateTokens) {
    const tok = tokens[ti];
    if (!tok) continue;
    for (let li = tok.leafStart; li <= tok.leafEnd; li++) {
      const lf = remainder[li];
      if (lf && !lf.consumed) {
        lf.consumed = true;
        marked.push(lf);
      }
    }
  }
  const notes = renderNote(source, leaves);
  for (const lf of marked) lf.consumed = false;
  return notes;
}

function toCandidate(
  source: string,
  leaves: readonly Leaf[],
  remainder: Leaf[],
  m: IngredientCandidateMatch,
): ImportedCandidateMatch {
  return {
    ingredientId: m.ingredientId,
    canonicalName: m.canonicalName,
    matchedName: m.aliasName,
    score: m.score,
    name: m.aliasName,
    notes: candidateNotes(source, leaves, remainder, m),
    isEquipment: m.isEquipment ?? false,
  };
}

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
    /** Known unit tokens — lets the no-match path peel a secondary "1 stick"
     *  amount off the front of the name into the notes. */
    units?: ReadonlySet<string>;
    /** The segment carries a container unit — keep a leading prep adjective in
     *  the name ("can crushed tomatoes" → "crushed tomatoes"). */
    hasContainer?: boolean;
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
  // Built on the base state (amount/unit/optional consumed, no ingredient yet),
  // before the best match is marked — so each pill renders independently.
  const candidateMatches = matches.map((m) => toCandidate(source, leaves, remainder, m));
  if (!best || best.score < threshold) {
    return noMatch(source, leaves, remainder, candidateMatches, opts.units, opts.hasContainer);
  }

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
  if (maxEnd > 0) {
    // The matched name is one continuous span — mark every leaf inside it
    // (interior dashes/punctuation included) as the name, so nothing between
    // the first and last matched token leaks into the notes.
    for (const lf of leaves) {
      if (lf.start >= minStart && lf.end <= maxEnd) {
        lf.consumed = true;
        lf.role = "ingredient";
      }
    }
    // A filler ("of"/"von") stranded between the consumed unit and the matched
    // span connects them and is meaningless alone — attribute it to the UNIT
    // (so the highlighter colours "can of" together) and keep it out of notes.
    const spanFirst = leaves.findIndex((l) => l.start === minStart);
    for (let k = spanFirst - 1; k >= 0; k--) {
      const l = leaves[k];
      if (l.consumed || l.depth !== 0) break;
      if (l.kind === "word" && NAME_FILLER.has(normWord(l.text))) {
        l.consumed = true;
        l.role = "unit";
        continue;
      }
      break;
    }
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
  // The matched source span verbatim — set whenever there's a covered span
  // (legacy computeNameAndNotes returns it unconditionally; the fold-separator
  // logic relies on it to detect a pre-name descriptor).
  let sourceName: string | null = null;
  if (maxEnd > 0) sourceName = source.slice(minStart, maxEnd).trim() || null;
  return {
    matched: true,
    ingredientId: best.ingredientId,
    name,
    canonicalName,
    sourceName,
    isEquipment: best.isEquipment ?? false,
    defaultUnit: best.defaultUnit ?? null,
    matches,
    candidateMatches,
    newNameProposals: [],
  };
}

/**
 * No catalog hit: the name is the core depth-0 word/number run up to the first
 * top-level comma, with leading size modifiers and a trailing vocab phrase
 * ("to taste", "zum Bestreuen") left UNCONSUMED so they fall into the notes —
 * mirroring the legacy no-match name (stripVocabTail + size peel).
 */
function noMatch(
  source: string,
  leaves: Leaf[],
  remainder: Leaf[],
  candidateMatches: ImportedCandidateMatch[],
  units?: ReadonlySet<string>,
  hasContainer?: boolean,
): MatchResult {
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
    (SIZE_MODIFIERS.has(normWord(lf.text)) ||
      PREP_WORDS.has(normWord(lf.text)) ||
      VAGUE_WORDS.has(normWord(lf.text)));
  // When the line carries a container unit ("can crushed tomatoes"), a leading
  // prep adjective is part of the canned product name — don't peel it off the
  // front. Size/vague modifiers still peel.
  const leadStrippable = (lf: Leaf): boolean =>
    hasContainer
      ? lf.kind === "word" &&
        (SIZE_MODIFIERS.has(normWord(lf.text)) || VAGUE_WORDS.has(normWord(lf.text)))
      : strippable(lf);

  let start = 0;
  let end = region.length;
  // Peel leading words: a filler ("of"/"von") connects the unit to the
  // ingredient and is meaningless on its own — attribute it to the UNIT (so the
  // highlighter colours "can of" together) and keep it out of the notes.
  // Size/prep/vague ("large", "ground", "etwas") stay in the notes.
  while (start < end) {
    const lf = region[start];
    if (lf.kind === "word" && NAME_FILLER.has(normWord(lf.text))) {
      lf.consumed = true;
      lf.role = "unit";
      start += 1;
      continue;
    }
    if (leadStrippable(lf)) {
      start += 1;
      continue;
    }
    if (lf.kind === "number") {
      // A leading size compound glued by a dash ("12-count rolls", "4-inch
      // stems") — keep BOTH the number and its compounded word in the notes,
      // never split them into the name.
      const glued = source[lf.end] !== undefined && !/\s/.test(source[lf.end]);
      const nxt = region[start + 1];
      if (glued && nxt && nxt.kind === "word") {
        start += 2;
        continue;
      }
      // Peel a leading SECONDARY amount ("½ cup 1 stick unsalted butter" → the
      // primary "½ cup" is already consumed; "1 stick" stays in the notes) — a
      // standalone number optionally followed by a known unit word.
      start += 1;
      if (nxt && nxt.kind === "word" && units?.has(normWord(nxt.text))) start += 1;
      continue;
    }
    break;
  }
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
  if (nameLeaves.length === 0) {
    return { ...EMPTY, candidateMatches };
  }
  // The name is ONE continuous span: mark every leaf within it — interior
  // dashes/punctuation included ("pull-apart") — as the name, so nothing
  // between the first and last name token leaks into the notes and the whole
  // span highlights as the name.
  const nameStart = nameLeaves[0].start;
  const nameEnd = nameLeaves[nameLeaves.length - 1].end;
  for (const lf of leaves) {
    if (lf.start >= nameStart && lf.end <= nameEnd) {
      lf.consumed = true;
      lf.role = "ingredient";
    }
  }
  const name = source
    .slice(nameLeaves[0].start, nameLeaves[nameLeaves.length - 1].end)
    .replace(/[­​-‍﻿]/gu, "") // invisible formatting chars
    .replace(/\s*[-–—]\s+|\s+[-–—]\s*/g, " ") // spaced separator dash → space
    .replace(/\s+/g, " ")
    .trim();
  const cleanedNotes = renderNote(source, leaves);
  // "Aufgeräumt" (cleaned) + "Wie eingegeben" (the full region, nothing peeled)
  // when they differ — mirrors the legacy two-proposal pair.
  const proposals: ImportedNameProposal[] = [
    { name, notes: cleanedNotes, label: "Aufgeräumt" },
  ];
  const rawName =
    region.length > 0
      ? source.slice(region[0].start, region[region.length - 1].end).trim()
      : name;
  if (rawName.toLowerCase() !== name.toLowerCase()) {
    const extra: Leaf[] = [];
    for (const lf of region) {
      if (!lf.consumed) {
        lf.consumed = true;
        extra.push(lf);
      }
    }
    const rawNotes = renderNote(source, leaves);
    for (const lf of extra) lf.consumed = false;
    proposals.push({ name: rawName, notes: rawNotes, label: "Wie eingegeben" });
  }
  return {
    matched: false,
    ingredientId: null,
    name,
    canonicalName: null,
    sourceName: null,
    isEquipment: false,
    defaultUnit: null,
    matches: [],
    candidateMatches,
    newNameProposals: proposals,
  };
}
