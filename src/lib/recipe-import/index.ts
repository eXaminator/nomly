import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  ingredient,
  ingredientAlias,
  unit,
  unitAlias,
} from "../../db/schema.ts";
import { fetchUrl, FetchError } from "./fetch.ts";
import {
  asImageUrl,
  asInstructionGroups,
  asServings,
  asString,
  asStringList,
  extractJsonLdRecipe,
  type JsonLdRecipe,
} from "./json-ld.ts";
import {
  alignHtmlGroupsToLines,
  extractIngredientGroupsFromHtml,
} from "./html-groups.ts";
import { parseIsoDurationToMinutes } from "./duration.ts";
import { parseSegment } from "./ast/parse-line.ts";
import {
  amountPrefixRange,
  findSegmentRange,
  trailingNoteRange,
  type HighlightPart,
  type SourceRange,
} from "./source-ranges.ts";
import {
  detectSectionHeader,
  expandIngredientLine,
  isPrepLeadingToken,
  normalizeForMatch,
  parseIngredientString,
  isStandaloneDescriptor,
  preprocessAlternatives,
  splitConjunctions,
  stripVocabTail,
  tidyRemainderFragment,
  tokenizeEntryNameForCatalog,
  type ParsedIngredient,
} from "./ingredient.ts";
import {
  MIN_AUTO_MATCH_SCORE,
  type CatalogBlockIndex,
  type IngredientCatalog,
} from "./matching.ts";
import { savePhotoBuffer, type PhotoPath } from "../photos.ts";
import { getGlobalDefaultUnitId } from "../settings/global-default-unit.ts";

export type IngredientMatch = "existing" | "new";
export type UnitMatch =
  /** unit string was parsed and matched an existing unit by name or alias */
  | "matched"
  /** no unit string parsed but a quantity was, so we defaulted to Stück */
  | "defaulted"
  /** parsed a unit token, didn't match anything */
  | "unresolved"
  /** neither a parsed unit nor a sensible default (e.g. "Salz nach Geschmack") */
  | "empty";

export type ImportedIngredient = {
  quantity: number | null;
  /** Best-effort resolved (global) unit. `id` null when we couldn't match
   *  anything; the UI uses {@link unitMatch} + {@link rawUnit} to render
   *  appropriately. */
  unit: { id: number; name: string } | null;
  unitMatch: UnitMatch;
  /** The unit token the parser saw, when we couldn't resolve it. */
  rawUnit: string | null;
  name: string;
  /** id of an existing ingredient when the name matched (canonical or alias),
   *  null when it'll be created on save. */
  ingredientId: number | null;
  ingredientMatch: IngredientMatch;
  /** Canonical name of the matched ingredient — only set when the typed
   *  name differs from the canonical (i.e. we matched via an alias). */
  canonicalIngredientName: string | null;
  /** The original source span the matched alias replaced ("Zwiebeln" when the
   *  display name became the alias "Zwiebel"). Null on the new-ingredient
   *  path. Lets the import-review UI offer the user's own spelling as the
   *  alias to remember. */
  sourceName: string | null;
  notes: string | null;
  /** True when the source line carried an "optional" marker ("opt.",
   *  "Optional:", "evtl.", "nach Belieben", "(optional)" inline, …). */
  isOptional: boolean;
  /** True when this row was the non-first piece of an `alternativ:` or
   *  `(Alternativ: X)` expansion. Always paired with `isOptional: true`.
   *  Downstream service inserts these with a non-null
   *  `recipe_ingredient.alternative_for_id` linking back to the most
   *  recent primary in the same section. */
  isAlternative: boolean;
  /** Transient hint (consumed by {@link applyAlternativeInheritance}): this
   *  alternative's note is its own and must not propagate to siblings — set
   *  for notes inside a parenthetical alternative. Not persisted. */
  localNote?: boolean;
  /** Char range `[start, end)` of this row's OWN segment in its original line
   *  (`rawText`). For an alternative it includes the connector. Drives
   *  fold-back-on-removal. Transient. */
  sourceRange?: SourceRange;
  /** Categorised highlight spans into `rawText` — the row's own segment split
   *  into amount/name/note parts, plus any inherited amount/note spans. The
   *  source-line view colours these (amount vs name vs note) and mutes the
   *  rest. Transient. */
  highlightParts?: HighlightPart[];
  /** Auto-set when the parser found no quantity — these lines describe an
   *  ingredient whose amount is portion-independent ("Salz nach Geschmack",
   *  "etwas Öl"). The recipe view can still override via the per-row toggle. */
  fixedAmount: boolean;
  /** The source substring this row was parsed from — after table pairing and
   *  conjunction splitting but before the parser pulled out quantity / unit /
   *  notes. Shown under the row in the import review UI so the user can
   *  verify what the parser saw. */
  rawText: string;
  /**
   * Up to five ranked ingredient matches for this row. The first entry is
   * the one we resolved to (mirrored by `ingredientId` / `name` /
   * `canonicalIngredientName`); the rest are alternatives the UI surfaces as
   * clickable pills. Empty when no catalog hit at all.
   */
  candidateMatches: ImportedCandidateMatch[];
  /**
   * Proposed names when nothing in the catalog matched (so the row will be
   * persisted as a new ingredient). At least one entry: the conservatively-
   * cleaned version (what `pickNameAndNotes` would have produced). Optional
   * additional entries are less-aggressive cleanups the user can opt into
   * via the pill UI. Empty when a catalog match was found.
   */
  newNameProposals: ImportedNameProposal[];
};

export type ImportedCandidateMatch = {
  ingredientId: number;
  canonicalName: string;
  /** The alias-or-canonical name the matcher hit on. */
  matchedName: string;
  score: number;
  /** Finished display name to apply if the user picks this candidate — the
   *  matched span of the input (first→last covered token). */
  name: string;
  /** Finished notes to apply if the user picks this candidate — the input
   *  tokens outside the span plus the parser's base notes. */
  notes: string | null;
  /** True when the underlying ingredient is flagged as equipment. The pill
   *  UI / live-match auto-select use this to default the row's
   *  `isOptional` to true when a row resolves to an equipment item,
   *  matching the import-time behavior in parseIngredientLines. */
  isEquipment: boolean;
};

export type ImportedNameProposal = {
  name: string;
  notes: string | null;
  /** Short label distinguishing this proposal from the others in the pill UI
   *  ("aufgeräumt" / "wie eingegeben"). */
  label: string;
};

export type ImportedSection = {
  title: string | null;
  instructions: string;
  ingredients: ImportedIngredient[];
};

export type ImportedRecipe = {
  title: string;
  description: string | null;
  servings: number;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  sourceUrl: string;
  photoPath: string | null;
  tags: string[];
  sections: ImportedSection[];
};

export class ImportError extends Error {
  constructor(
    message: string,
    public readonly code: "fetch" | "parse" | "noRecipe" | "image",
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export type UnitLookupEntry = {
  id: number;
  name: string;
  isContainer: boolean;
};
export type UnitLookup = {
  byNameOrAlias: Map<string, UnitLookupEntry>;
  byCanonicalName: Map<string, UnitLookupEntry>;
  /** Canonical units keyed by id — lets the global-default pointer resolve to
   *  a concrete entry. */
  byId: Map<number, UnitLookupEntry>;
  /**
   * Lowercased tokens (canonical names + aliases) of units flagged as
   * containers. The parser uses this set to suppress conjunction-splitting
   * and prep-word stripping when a container is present.
   */
  containerTokens: Set<string>;
  /** The configured global default unit id (or null) — the terminal fallback
   *  for a quantity-bearing line with no explicit unit. */
  globalDefaultUnitId: number | null;
};

export function buildUnitLookup(): UnitLookup {
  const byNameOrAlias = new Map<string, UnitLookupEntry>();
  const byCanonicalName = new Map<string, UnitLookupEntry>();
  const byId = new Map<number, UnitLookupEntry>();
  const containerTokens = new Set<string>();
  const canonical = db
    .select({
      id: unit.id,
      name: unit.name,
      plural: unit.plural,
      isContainer: unit.isContainer,
    })
    .from(unit)
    .all();
  for (const u of canonical) {
    const lower = u.name.toLowerCase();
    const entry: UnitLookupEntry = {
      id: u.id,
      name: u.name,
      isContainer: u.isContainer,
    };
    byNameOrAlias.set(lower, entry);
    byCanonicalName.set(lower, entry);
    byId.set(u.id, entry);
    if (u.isContainer) containerTokens.add(lower);
    // A configured plural ("Dose" → "Dosen") is matchable too, but never
    // overwrites a singular already claimed by another unit/alias.
    if (u.plural) {
      const pl = u.plural.toLowerCase();
      if (!byNameOrAlias.has(pl)) byNameOrAlias.set(pl, entry);
      if (u.isContainer) containerTokens.add(pl);
    }
  }
  const aliases = db
    .select({
      id: unit.id,
      canonicalName: unit.name,
      isContainer: unit.isContainer,
      aliasName: unitAlias.name,
      aliasPlural: unitAlias.plural,
    })
    .from(unitAlias)
    .innerJoin(unit, eq(unit.id, unitAlias.unitId))
    .all();
  for (const a of aliases) {
    const entry: UnitLookupEntry = {
      id: a.id,
      name: a.canonicalName,
      isContainer: a.isContainer,
    };
    for (const token of [a.aliasName, a.aliasPlural]) {
      if (!token) continue;
      const key = token.toLowerCase();
      if (!byNameOrAlias.has(key)) byNameOrAlias.set(key, entry);
      if (a.isContainer) containerTokens.add(key);
    }
  }
  return {
    byNameOrAlias,
    byCanonicalName,
    byId,
    containerTokens,
    globalDefaultUnitId: getGlobalDefaultUnitId(),
  };
}

export type ResolveUnitResult = {
  resolved: { id: number; name: string } | null;
  match: UnitMatch;
  rawUnit: string | null;
};

export function resolveUnit(
  lookup: UnitLookup,
  rawUnitName: string | null,
  quantity: number | null,
): ResolveUnitResult {
  if (rawUnitName) {
    const key = rawUnitName.toLowerCase();
    const direct = lookup.byNameOrAlias.get(key);
    if (direct) {
      // The imported token may still differ from the canonical (alias hit
      // or different casing/plural) — surface it as `rawUnit` so the UI can
      // show the import-time spelling alongside the resolved canonical
      // (e.g. "tablespoon" → EL, "Cups" → Cup).
      const rawUnit =
        rawUnitName.toLowerCase() === direct.name.toLowerCase()
          ? null
          : rawUnitName;
      return { resolved: direct, match: "matched", rawUnit };
    }
    return { resolved: null, match: "unresolved", rawUnit: rawUnitName };
  }
  // No unit token. Default a quantity-bearing line ("3 Eier") to the configured
  // global default unit, falling back to literal "Stück" when the pointer is
  // unset or dangling.
  if (quantity !== null && quantity > 0) {
    const fallback =
      (lookup.globalDefaultUnitId != null
        ? lookup.byId.get(lookup.globalDefaultUnitId)
        : undefined) ?? lookup.byCanonicalName.get("stück");
    if (fallback) {
      return { resolved: fallback, match: "defaulted", rawUnit: null };
    }
  }
  return { resolved: null, match: "empty", rawUnit: null };
}

export type IngredientLookupHit = {
  id: number;
  canonicalName: string;
  /** Per-alias default global unit. Used when the parser hits the alias with
   *  no explicit unit. Since sub-units became global units, an alias like
   *  "Knoblauchzehe" simply defaults to the "Zehe" unit here. */
  defaultUnit?: { id: number; name: string };
};
export type IngredientLookup = Map<string, IngredientLookupHit>;

/**
 * Walk every canonical ingredient + every alias row and emit one
 * {@link CatalogEntry} per *name we might match against*. Pre-tokenises each
 * name so the matcher doesn't have to re-do the work per row. Used by both
 * the parser (at recipe-import time) and the /match endpoint (for live
 * pill updates as the user types in the IngredientRow).
 */
export function buildIngredientCatalog(): IngredientCatalog {
  const out: IngredientCatalog = [];
  // NOTE: an entry's matching unit (`unitId`) is CURATED-ONLY (alias default →
  // ingredient default). The global default unit deliberately does NOT flow in
  // here: it exists to give unit-less LINES a unit, and routing it into the
  // catalog handed every uncurated entry a phantom "Stück" that then "agreed"
  // with a defaulted line unit — doubling a weak name match past a strong
  // curated one ("1 garlic clove crushed" picked Nelken via "cloves" over
  // Knoblauch's exact "garlic clove"/Zehe).
  const canonicals = db
    .select({
      id: ingredient.id,
      name: ingredient.name,
      isEquipment: ingredient.isEquipment,
      defaultUnitId: ingredient.defaultUnitId,
      defaultUnitName: unit.name,
      defaultUnitDisplay: ingredient.defaultUnitDisplay,
    })
    .from(ingredient)
    .leftJoin(unit, eq(unit.id, ingredient.defaultUnitId))
    .all();
  for (const i of canonicals) {
    out.push({
      ingredientId: i.id,
      canonicalName: i.name,
      aliasName: i.name,
      tokens: tokenizeEntryNameForCatalog(i.name),
      // Default unit's display = the chosen spelling (a unit alias like
      // "clove") when set, else the canonical unit name.
      defaultUnit:
        i.defaultUnitId != null && i.defaultUnitName != null
          ? { id: i.defaultUnitId, name: i.defaultUnitDisplay ?? i.defaultUnitName }
          : undefined,
      // Curated matching unit: ingredient default only (no global fallback).
      unitId: i.defaultUnitId ?? undefined,
      isEquipment: i.isEquipment || undefined,
    });
  }
  const aliases = db
    .select({
      id: ingredient.id,
      canonicalName: ingredient.name,
      isEquipment: ingredient.isEquipment,
      ingredientDefaultUnitId: ingredient.defaultUnitId,
      aliasName: ingredientAlias.name,
      aliasDisplayName: ingredientAlias.displayName,
      defaultUnitId: ingredientAlias.defaultUnitId,
      defaultUnitName: unit.name,
      defaultUnitDisplay: ingredientAlias.defaultUnitDisplay,
    })
    .from(ingredientAlias)
    .innerJoin(ingredient, eq(ingredient.id, ingredientAlias.ingredientId))
    .leftJoin(unit, eq(unit.id, ingredientAlias.defaultUnitId))
    .all();
  for (const a of aliases) {
    out.push({
      ingredientId: a.id,
      canonicalName: a.canonicalName,
      aliasName: a.aliasName,
      tokens: tokenizeEntryNameForCatalog(a.aliasName),
      defaultUnit:
        a.defaultUnitId != null && a.defaultUnitName != null
          ? { id: a.defaultUnitId, name: a.defaultUnitDisplay ?? a.defaultUnitName }
          : undefined,
      // Curated matching unit: alias default → ingredient default (no global
      // fallback).
      unitId: a.defaultUnitId ?? a.ingredientDefaultUnitId ?? undefined,
      displayName: a.aliasDisplayName ?? undefined,
      isEquipment: a.isEquipment || undefined,
    });
  }
  return out;
}

export function buildIngredientLookup(): IngredientLookup {
  const lookup: IngredientLookup = new Map();
  const canonical = db
    .select({
      id: ingredient.id,
      name: ingredient.name,
      defaultUnitId: ingredient.defaultUnitId,
      defaultUnitName: unit.name,
      defaultUnitDisplay: ingredient.defaultUnitDisplay,
    })
    .from(ingredient)
    .leftJoin(unit, eq(unit.id, ingredient.defaultUnitId))
    .all();
  // Two keys per row: the lowercase form AND the diacritic-stripped form.
  // The stripped form lets "Möhre" / "Moehre"-style inputs match the same
  // row when the user has only typed an ASCII-ish approximation. Lowercase
  // takes precedence (set first), so we never replace an existing exact
  // match with a different row's normalized hit.
  function add(key: string, hit: IngredientLookupHit) {
    if (!lookup.has(key)) lookup.set(key, hit);
  }
  for (const i of canonical) {
    const hit: IngredientLookupHit = {
      id: i.id,
      canonicalName: i.name,
      defaultUnit:
        i.defaultUnitId != null && i.defaultUnitName != null
          ? { id: i.defaultUnitId, name: i.defaultUnitDisplay ?? i.defaultUnitName }
          : undefined,
    };
    add(i.name.toLowerCase(), hit);
    add(normalizeForMatch(i.name), hit);
  }
  const aliases = db
    .select({
      id: ingredient.id,
      canonicalName: ingredient.name,
      aliasName: ingredientAlias.name,
      defaultUnitId: ingredientAlias.defaultUnitId,
      defaultUnitName: unit.name,
      defaultUnitDisplay: ingredientAlias.defaultUnitDisplay,
    })
    .from(ingredientAlias)
    .innerJoin(ingredient, eq(ingredient.id, ingredientAlias.ingredientId))
    .leftJoin(unit, eq(unit.id, ingredientAlias.defaultUnitId))
    .all();
  for (const a of aliases) {
    const hit: IngredientLookupHit = {
      id: a.id,
      canonicalName: a.canonicalName,
      defaultUnit:
        a.defaultUnitId != null && a.defaultUnitName != null
          ? { id: a.defaultUnitId, name: a.defaultUnitDisplay ?? a.defaultUnitName }
          : undefined,
    };
    add(a.aliasName.toLowerCase(), hit);
    add(normalizeForMatch(a.aliasName), hit);
  }
  return lookup;
}

export function resolveIngredientName(
  lookup: IngredientLookup,
  rawName: string,
): {
  id: number | null;
  match: IngredientMatch;
  canonicalName: string | null;
  defaultUnit: { id: number; name: string } | null;
} {
  const trimmed = rawName.trim();
  const key = trimmed.toLowerCase();
  // Try exact lowercase first, then fall back to the diacritic-stripped
  // form ("Möhre" → "mohre" → match).
  const hit = lookup.get(key) ?? lookup.get(normalizeForMatch(trimmed));
  if (hit === undefined)
    return {
      id: null,
      match: "new",
      canonicalName: null,
      defaultUnit: null,
    };
  const canonicalName =
    hit.canonicalName.toLowerCase() === key ? null : hit.canonicalName;
  return {
    id: hit.id,
    match: "existing",
    canonicalName,
    defaultUnit: hit.defaultUnit ?? null,
  };
}

void sql; // kept for future tuning; the import side reads everything via JS.


export type ParseLookups = {
  units: UnitLookup;
  ingredients: IngredientLookup;
  /** Pre-built ingredient catalog for the substring matcher. Optional for
   *  backward compatibility — callers that don't provide it get the old
   *  exact-lookup behaviour. */
  ingredientCatalog?: IngredientCatalog;
  /** Optional block index for {@link ingredientCatalog} — when present, the
   *  matcher prunes its candidate sweep (used by the bulk reparse scan, which
   *  parses thousands of lines against the same catalog). Must be built from
   *  the SAME catalog instance. */
  ingredientCatalogIndex?: CatalogBlockIndex;
};

/**
 * Apply an alias/ingredient default unit on top of the initial global-unit
 * resolution. Order of precedence:
 *   1. The unit token resolved to a real global unit ("g", "EL", "Zehe")    → unit
 *   2. No (or unmatched) unit token, but the ingredient was matched via an
 *      entry that defines a default unit ("Knoblauchzehe" → Zehe)           → default
 *   3. Initial fallback (Stück for "3 Eier", or unresolved/empty)
 *
 * Since the former ingredient sub-units are now global units, a token like
 * "Zehe" already resolves in step 1 via {@link resolveUnit}; the default-unit
 * branch only fills in when the line carried no usable unit token of its own.
 */
function pickFinalUnit(
  initial: ResolveUnitResult,
  aliasDefaultUnit: { id: number; name: string } | null,
  quantity: number | null,
): {
  resolved: { id: number; name: string } | null;
  match: UnitMatch;
  rawUnit: string | null;
} {
  if (initial.match === "matched") {
    return {
      resolved: initial.resolved,
      match: initial.match,
      rawUnit: initial.rawUnit,
    };
  }
  if (
    (initial.match === "defaulted" || initial.match === "empty") &&
    aliasDefaultUnit &&
    // Only attach a default unit when there is an amount for it to qualify.
    // A quantity-less line ("n. B. Eisbergsalat", "Salz") has no slot for a
    // unit — "Kopf Eisbergsalat" makes no sense. This mirrors the global
    // default in {@link resolveUnit}, which also requires a positive amount.
    quantity !== null &&
    quantity > 0
  ) {
    // An alias/ingredient default supplies a *resolved* unit — treat it as a
    // clean match so the import-review UI shows the picked unit as the actual
    // selection rather than a "Standard: Stück" badge on top of it.
    return { resolved: aliasDefaultUnit, match: "matched", rawUnit: null };
  }
  return {
    resolved: initial.resolved,
    match: initial.match,
    rawUnit: initial.rawUnit,
  };
}

/**
 * Per-importer knobs that loosen the parser's defensive defaults. URL /
 * paste / API callers leave these unset (strict behavior). Familywall
 * passes `alternativesMode: "first-wins"` + a relaxed
 * `autoMatchScoreThreshold` because its catalog is exhaustive — falling
 * back to "new ingredient" there is a worse outcome than absorbing a
 * descriptor compound into the broader catalog row.
 */
export type ParseIngredientsOptions = {
  /**
   * How `X oder Y` alternatives + adjacent unconjoined pairs are handled:
   *  - "preserve" (default) — leave the user's text alone, let the matcher
   *    see "Butter oder Margarine" as a 3-token candidate.
   *  - "first-wins" — drop "oder Y" tails (Butter wins), expand dash-prefix
   *    "Weizen- oder Dinkelmehl" → "Weizenmehl", and inject `und` between
   *    adjacent Salz/Pfeffer pairs so the conjunction splitter yields two
   *    rows.
   */
  alternativesMode?: "preserve" | "first-wins";
  /**
   * Auto-match score gate. Default {@link MIN_AUTO_MATCH_SCORE}. Lower it
   * (e.g. 130) only when the catalog is known to cover every ingredient
   * the source might mention.
   */
  autoMatchScoreThreshold?: number;
};

export function parseIngredientLines(
  lines: readonly string[],
  lookups: ParseLookups,
  options: ParseIngredientsOptions = {},
): ImportedIngredient[] {
  const knownUnitTokens = new Set<string>([
    ...lookups.units.byNameOrAlias.keys(),
  ]);
  const knownIngredientKeys = new Set(lookups.ingredients.keys());
  const splitOpts = {
    containerTokens: lookups.units.containerTokens,
    knownIngredients: knownIngredientKeys,
  };
  const threshold = options.autoMatchScoreThreshold ?? MIN_AUTO_MATCH_SCORE;
  const useFirstWins = options.alternativesMode === "first-wins";
  const out: ImportedIngredient[] = [];
  for (const rawLine of lines) {
    // Section headers (e.g. "Für den Teig:", "FÜR DIE FÜLLUNG") aren't
    // ingredients — section-aware callers use parseIngredientLinesIntoSections.
    if (detectSectionHeader(rawLine)) continue;
    // Skip pure-noise lines (no letters at all, e.g. "—–", "***").
    if (!/\p{L}/u.test(rawLine)) continue;

    // Index of the last PRIMARY (non-alternative) row emitted from this input
    // line. Used to fold an alternative back into its primary's notes when
    // the alternative doesn't match a catalog article. Scoped per rawLine so
    // an alt from this line never folds into a primary from a previous line.
    let lastPrimaryIndex: number | null = null;
    // Cursor for mapping each emitted piece back to a char range in the
    // (trimmed) source line. `rawText` on emitted rows equals this string.
    const originalTrimmed = rawLine.trim();
    let sourceCursor = 0;
    // A note that trailed a parenthetical alternative ("(or 1 large clove),
    // peeled"). Appended to the primary AFTER the line's alternatives fold in,
    // so it keeps its source order ("small, or 1 large clove, peeled").
    let pendingTailNote: string | null = null;

    for (const row of expandIngredientLine(rawLine)) {
      if (row.kind === "header") continue;
      if (row.tailNote) pendingTailNote = row.tailNote;
      // Familywall opt-in: pre-resolve "X oder Y" alternatives + adjacent-pair
      // conjunctions (Salz Pfeffer) before the conjunction splitter runs.
      const raw = useFirstWins
        ? preprocessAlternatives(row.text, knownIngredientKeys)
        : row.text;
      for (const piece of splitConjunctions(raw, splitOpts)) {
        // ONE AST parse of this piece is the single source of truth: quantity,
        // unit, faithful notes, name, ingredient match, candidate pills, and
        // new-name proposals — all from one lex + one match.
        const astSeg = parseSegment(piece, {
          knownUnitTokens,
          catalog: lookups.ingredientCatalog ?? [],
          catalogIndex: lookups.ingredientCatalogIndex,
          threshold,
          lineUnitId: (name, qty) =>
            resolveUnit(lookups.units, name, qty).resolved?.id ?? null,
        });
        const astNote = astSeg.notes;
        const sourceRange = findSegmentRange(
          originalTrimmed,
          piece,
          sourceCursor,
          row.isAlternative,
        );
        if (sourceRange) sourceCursor = sourceRange[1];
        // An optional marker makes the WHOLE block optional: when it sits on an
        // alternative ("… (oder X, optional)"), flag the primary too.
        if (astSeg.isOptional && row.isAlternative && lastPrimaryIndex !== null) {
          out[lastPrimaryIndex].isOptional = true;
        }
        // Skip the row when the parser couldn't pull a real ingredient name
        // out of the line. Familywall data legitimately has entries like
        // "2 Prise" / "200 g" / "5-7 EL" with no ingredient — there's nothing
        // useful to import, and falling back to the raw piece would create
        // a garbage row in the global ingredient catalog ("2 Prise" as an
        // ingredient). Same for fragments produced by conjunction splitting
        // that turn out to be empty.
        if (astSeg.name.trim().length === 0) {
          // A nameless ALTERNATIVE ("1/2 large head" — the same ingredient in
          // a different amount, no article of its own) can't become a row;
          // fold it into the primary's notes instead of dropping it. A purely
          // note-only alt ("(oder nach Geschmack)" — no amount/unit) qualifies
          // the WHOLE group, so it folds onto the primary AND every alternative
          // emitted since; an amount-only one folds onto the primary alone.
          if (row.isAlternative && lastPrimaryIndex !== null) {
            const isNoteOnly = astSeg.quantity === null && astSeg.unitName === null;
            const foldEnd = isNoteOnly ? out.length - 1 : lastPrimaryIndex;
            for (let ti = lastPrimaryIndex; ti <= foldEnd; ti++) {
              appendAlternativeToNotes(
                out[ti],
                row.alternativeConnector,
                piece.trim(),
                originalTrimmed,
              );
              if (sourceRange) {
                (out[ti].highlightParts ??= []).push({
                  range: sourceRange,
                  kind: "note",
                });
              }
            }
          }
          continue;
        }
        // Defensive: a colon still in the parsed name means none of the
        // expansion rules caught the line. Drop rather than pollute the
        // catalog with a colon-bearing ingredient name.
        if (astSeg.name.includes(":")) continue;
        // Familywall opt-in: drop rows whose name is a bare descriptor token
        // ("frische", "fresh", "red") with no head noun — usually truncated
        // source lines like "8 frische" or "1 cup fresh". Without this, the
        // first such row creates a "frische" canonical and subsequent
        // "frische X" lines tie at score 130 between the orphan and the real
        // head-noun canonical, cascading more orphan matches.
        if (useFirstWins && isStandaloneDescriptor(astSeg.name)) continue;
        // A leading "or X" / "oder X" almost always means we just split a
        // conjunction that connected alternatives. Attach as a note on the
        // previous row instead of creating a separate ingredient.
        const leadingOr = /^(?:or|oder)\s+(.+)/i.exec(astSeg.name.trim());
        if (leadingOr && out.length > 0) {
          const alt = leadingOr[1];
          const prev = out[out.length - 1];
          prev.notes = prev.notes ? `${prev.notes}, oder ${alt}` : `oder ${alt}`;
          if (astSeg.isOptional || row.forceOptional) prev.isOptional = true;
          continue;
        }
        const initialUnit = resolveUnit(
          lookups.units,
          astSeg.unitName,
          astSeg.quantity,
        );
        // Fold an unmatched alternative back into its primary's notes instead
        // of creating an "orphan new-ingredient" row. Most recipe "or"s mean
        // "or you could use this instead" rather than a parallel shopping
        // entry — when the catalog doesn't recognise the alternative, the
        // user's intent is information for the cook, not a second purchase.
        if (
          row.isAlternative &&
          !astSeg.matched &&
          lastPrimaryIndex !== null
        ) {
          // A trailing alternative that is PURELY a note phrase ("(oder nach
          // Geschmack)", "(oder zum Abschmecken)") doesn't belong to one
          // alternative — it qualifies the whole group (typically the amount),
          // so fold it onto the primary AND every alternative emitted since.
          // A rejected INGREDIENT alternative ("(oder schwarze Bohnen)") leaves
          // a name behind and stays on the primary alone. stripVocabTail is the
          // same vocabulary gate the no-match path already uses.
          const isNoteOnly =
            stripVocabTail(piece.trim()).name.trim().length === 0;
          const foldEnd = isNoteOnly ? out.length - 1 : lastPrimaryIndex;
          for (let ti = lastPrimaryIndex; ti <= foldEnd; ti++) {
            appendAlternativeToNotes(
              out[ti],
              row.alternativeConnector,
              piece.trim(),
              originalTrimmed,
            );
            // The folded text is now part of this row's NOTES output, so show
            // its source span (incl. connector) as a note on the row's line
            // rather than muting it.
            if (sourceRange) {
              (out[ti].highlightParts ??= []).push({
                range: sourceRange,
                kind: "note",
              });
            }
          }
          continue;
        }
        const final = pickFinalUnit(initialUnit, astSeg.defaultUnit, astSeg.quantity);
        out.push({
          quantity: astSeg.quantity,
          unit: final.resolved,
          unitMatch: final.match,
          rawUnit: final.rawUnit,
          sourceRange: sourceRange ?? undefined,
          highlightParts: astHighlights(
            originalTrimmed,
            sourceRange,
            piece,
            row.alternativeConnector,
            astSeg.highlightParts,
          ),
          name: astSeg.name,
          ingredientId: astSeg.ingredientId,
          ingredientMatch: astSeg.matched ? "existing" : "new",
          canonicalIngredientName: astSeg.canonicalName,
          sourceName: astSeg.sourceName,
          notes: astNote,
          // Equipment-flagged ingredients (Backpapier, Einmachgläser …)
          // default to optional so the user decides per-recipe whether they
          // actually need to shop them. `forceOptional` carries through
          // Optional:/alternativ: wrappers from the expansion pass.
          isOptional: astSeg.isOptional || astSeg.isEquipment || row.forceOptional,
          isAlternative: row.isAlternative,
          localNote: row.localNote,
          // No parsed quantity → treat the amount as constant. Catches
          // "Salz nach Geschmack" / "etwas Olivenöl" so changing the meal's
          // portion size doesn't multiply a non-existent number.
          fixedAmount: astSeg.quantity === null,
          // For expanded rows (Optional:, alternativ:, list-after-colon,
          // each:), surface the user's ORIGINAL full line in rawText —
          // makes it clear in the import-review UI which source line each
          // resulting ingredient came from.
          rawText: row.rawText !== row.text ? row.rawText : piece.trim(),
          candidateMatches: astSeg.candidateMatches,
          newNameProposals: astSeg.newNameProposals,
        });
        if (!row.isAlternative) lastPrimaryIndex = out.length - 1;
      }
    }
    if (pendingTailNote && lastPrimaryIndex !== null) {
      appendAlternativeToNotes(
        out[lastPrimaryIndex],
        null,
        pendingTailNote,
        originalTrimmed,
      );
      const idx = originalTrimmed.indexOf(pendingTailNote);
      if (idx >= 0) {
        (out[lastPrimaryIndex].highlightParts ??= []).push({
          range: [idx, idx + pendingTailNote.length],
          kind: "note",
        });
      }
    }
  }
  applyAlternativeInheritance(out);
  return out;
}

function appendAlternativeToNotes(
  target: ImportedIngredient,
  connector: string | null,
  altText: string,
  source: string,
): void {
  const fragment = connector
    ? `${connector} ${altText}`.trim()
    : altText.trim();
  if (fragment.length === 0) return;
  if (!target.notes) {
    target.notes = fragment;
    return;
  }
  const sep = alternativeNoteSeparator(target, source, connector, altText);
  target.notes = `${target.notes}${sep}${fragment}`;
}

/**
 * Separator to place before a folded alternative in the notes. The rule:
 * keep the source text between the previous note and this alternative AS IS,
 * unless something was stripped there (the matched name, a consumed unit) —
 * then a comma stands in for the removed words.
 *
 *   "red chili powder (or to taste)" → "red, or to taste"  (name removed)
 *   "…Zucker, Reis oder Rübensirup"  → "…Reis oder Rübensirup" (nothing removed)
 *   "…pieces, or small florets"      → "…pieces, or small florets" (source comma)
 *
 * Falls back to the local "comma right before the connector?" check when the
 * source span of the previous note can't be located.
 */
function alternativeNoteSeparator(
  target: ImportedIngredient,
  source: string,
  connector: string | null,
  altText: string,
): string {
  const lc = source.toLowerCase();
  const connectorStart = connector
    ? lc.indexOf(`${connector} ${altText}`.toLowerCase())
    : -1;
  // When the matched ingredient name sits between an earlier note and this
  // alternative ("red [chili powder] (or to taste)"), it was stripped — a comma
  // stands in for the removed name. The name's own highlight is "name"-kind, so
  // a "note" highlight that STARTS before it is a genuine pre-name descriptor.
  if (connectorStart >= 0 && target.sourceName) {
    const nameStart = lc.indexOf(target.sourceName.toLowerCase());
    const nameEnd = nameStart >= 0 ? nameStart + target.sourceName.length : -1;
    const hasPreNameNote = (target.highlightParts ?? []).some(
      (p) =>
        p.kind === "note" &&
        p.range[0] < nameStart &&
        /[\p{L}\p{N}]/u.test(source.slice(p.range[0], p.range[1])),
    );
    if (nameStart >= 0 && nameEnd <= connectorStart && hasPreNameNote) return ", ";
  }
  return sourceCommaBeforeAlt(source, connector, altText) ? ", " : " ";
}

/**
 * Did the source put a comma right before this alternative's connector
 * (",  or X" vs " or X")? Anchors on "<connector> <altText>" and inspects the
 * preceding non-space char. Defaults to true (keep the comma) when the span
 * can't be located or there's no connector — a distinct note reads with one.
 */
function sourceCommaBeforeAlt(
  source: string,
  connector: string | null,
  altText: string,
): boolean {
  if (!connector) return true;
  const needle = `${connector} ${altText}`.toLowerCase();
  const idx = source.toLowerCase().indexOf(needle);
  if (idx < 0) return true;
  let i = idx - 1;
  while (i >= 0 && /\s/.test(source[i])) i -= 1;
  return source[i] === ",";
}

/**
 * Copy a primary's amount/unit/notes onto its alternatives at parse time.
 * Walks the row list as a sequence of groups ([primary, alt, alt, …]; an
 * alternative always follows its primary). For each group:
 *   - Amount/unit: an alternative that parsed NEITHER its own quantity NOR
 *     its own unit inherits both from the primary. One that brought either
 *     keeps what it parsed ("2 eggs or 3 egg whites" → egg whites stays 3).
 *   - Notes: the trailing note of the LAST group member propagates to every
 *     earlier sibling that has no note of its own ("2 slices bacon or
 *     pancetta, diced" → both get "diced"). Members with their own note keep
 *     it.
 * Mutates the rows in place. Only matched alternatives are rows here —
 * unmatched ones already folded into the primary's notes upstream.
 */
function applyAlternativeInheritance(rows: ImportedIngredient[]): void {
  let i = 0;
  while (i < rows.length) {
    if (rows[i].isAlternative) {
      // Orphan alternative with no preceding primary (rare) — skip.
      i += 1;
      continue;
    }
    let hi = i;
    while (hi + 1 < rows.length && rows[hi + 1].isAlternative) hi += 1;
    if (hi > i) inheritWithinGroup(rows, i, hi);
    i = hi + 1;
  }
}

/**
 * Re-base the AST's piece-relative highlight spans onto the full line. The
 * segment may lead with the alternative's connector ("oder …"), which the piece
 * doesn't include — so spans rebase from where the piece actually starts in the
 * segment, and the connector itself is added as a "dropped" span.
 */
function astHighlights(
  line: string,
  sourceRange: SourceRange | null,
  piece: string,
  connector: string | null,
  parts: HighlightPart[],
): HighlightPart[] | undefined {
  if (!sourceRange) return undefined;
  const seg = line.slice(sourceRange[0], sourceRange[1]);
  const ci = seg.lastIndexOf(piece.trim());
  const contentStart = ci > 0 ? ci : 0;
  const base = sourceRange[0] + contentStart;
  const out: HighlightPart[] = parts.map((p) => ({
    kind: p.kind,
    range: [base + p.range[0], base + p.range[1]] as SourceRange,
  }));
  if (connector && contentStart > 0) {
    const cIdx = seg.toLowerCase().indexOf(connector.toLowerCase());
    if (cIdx >= 0) {
      out.unshift({
        kind: "dropped",
        range: [sourceRange[0] + cIdx, sourceRange[0] + cIdx + connector.length],
      });
    }
  }
  return out;
}

/** Re-base a within-segment range onto the full line and stash it as an
 *  inherited highlight part of the given kind. No-op when the local range is
 *  null (segment not located / nothing to inherit). */
function addInheritedPart(
  row: ImportedIngredient,
  base: SourceRange | undefined,
  local: SourceRange | null,
  kind: HighlightPart["kind"],
): void {
  if (!base || !local) return;
  (row.highlightParts ??= []).push({
    range: [base[0] + local[0], base[0] + local[1]],
    kind,
  });
}

function inheritWithinGroup(
  rows: ImportedIngredient[],
  lo: number,
  hi: number,
): void {
  const primary = rows[lo];
  // The range expression the primary recorded in notes ("2-3", "0,5-1") when
  // it resolved a range to its high bound. An alt that inherits the amount
  // took the same high bound, so it inherits the range note too.
  // Pull the range expression straight out of the notes — don't split on
  // commas first, since a German decimal range ("0,25-0,75 teaspoon") contains
  // commas that the split would shred into "25-0". The optional trailing word
  // captures the unit the range note now carries.
  const primaryRange = (primary.notes ?? "").match(
    /\d[\d.,/]*\s*[-–]\s*\d[\d.,/]*(?:\s+\p{L}+)?/u,
  )?.[0];
  // Source range of the primary's amount/unit, so an alt that inherits the
  // amount keeps it un-muted on its own line.
  const primaryAmountLocal = primary.sourceRange
    ? amountPrefixRange(
        primary.rawText.slice(primary.sourceRange[0], primary.sourceRange[1]),
        primary.quantity !== null,
        primary.rawUnit ?? primary.unit?.name ?? null,
      )
    : null;
  for (let k = lo + 1; k <= hi; k++) {
    const alt = rows[k];
    const hasOwnAmount = alt.quantity !== null;
    const hasOwnUnit = alt.unit !== null;
    if (hasOwnAmount || hasOwnUnit) continue;
    alt.quantity = primary.quantity;
    alt.fixedAmount = primary.fixedAmount;
    alt.unit = primary.unit;
    alt.unitMatch = primary.unitMatch;
    alt.rawUnit = primary.rawUnit;
    addInheritedPart(alt, primary.sourceRange, primaryAmountLocal, "amount");
    if (primaryRange) {
      const cur = alt.notes?.trim();
      alt.notes = cur && cur.length > 0 ? `${primaryRange}, ${cur}` : primaryRange;
    }
  }
  // Trailing note of the last member → siblings that have none of their own.
  // Only a genuinely shared (line-trailing) note propagates: a note that
  // belongs to a single parenthetical alternative ("Salz (oder Pfeffer,
  // frisch gemahlen)") is flagged `localNote` and stays put.
  const sharedNote = rows[hi].localNote ? undefined : rows[hi].notes?.trim();
  // Source range of that shared note within the last member's segment, so each
  // inheriting sibling can keep it un-muted on its own line.
  const sharedNoteLocal =
    sharedNote && rows[hi].sourceRange
      ? trailingNoteRange(
          rows[hi].rawText.slice(rows[hi].sourceRange![0], rows[hi].sourceRange![1]),
          sharedNote,
        )
      : null;
  if (sharedNote && sharedNote.length > 0) {
    for (let k = lo; k < hi; k++) {
      const cur = rows[k].notes?.trim();
      // Only siblings that brought no note of their own inherit the shared
      // prep — one that kept its own ("1 onion, finely chopped, or 2 shallots,
      // diced") keeps it on both the row and its candidates.
      if (cur && cur.length > 0) continue;
      rows[k].notes = sharedNote;
      addInheritedPart(rows[k], rows[hi].sourceRange, sharedNoteLocal, "note");
      // The shared prep also belongs on each sibling's candidate matches: a
      // candidate's `notes` is "what this row's notes become if you pick it",
      // and picking it from the pill UI replaces the row's notes wholesale.
      // Without mirroring the shared note here, clicking a candidate on the
      // primary ("button or cremini mushrooms, halved and quartered" → pick
      // Champignon) would drop the group-shared "halved and quartered".
      rows[k].candidateMatches = rows[k].candidateMatches.map((c) =>
        mergeSharedNote(c, sharedNote),
      );
    }
  }
}

/** Append the group-shared prep note to a candidate's own notes (dedup-safe),
 *  so picking it from the pill UI keeps the shared prep instead of replacing
 *  the row's notes with the candidate's narrower, pre-inheritance value. */
function mergeSharedNote(
  c: ImportedCandidateMatch,
  sharedNote: string,
): ImportedCandidateMatch {
  const cur = c.notes?.trim();
  if (!cur || cur.length === 0) return { ...c, notes: sharedNote };
  if (cur.toLowerCase().includes(sharedNote.toLowerCase())) return c;
  return { ...c, notes: `${cur}, ${sharedNote}` };
}

export type ParsedSectionGroup = {
  /** Section title (null = the first/default unnamed section). */
  title: string | null;
  ingredients: ImportedIngredient[];
};

export type PreGroupedLines = {
  /** Group title (null = unnamed lead-in group). */
  title: string | null;
  lines: readonly string[];
};

/**
 * Section-aware variant for the clipboard-paste flow: scans for section
 * headers (lines like "Für den Teig:", "FÜR DIE FÜLLUNG", "--- Sauce ---"),
 * splits ingredients into groups, and applies conjunction splitting inside
 * each group. The first group has `title: null` and collects any ingredients
 * that appear before the first header.
 */
export function parseIngredientLinesIntoSections(
  lines: readonly string[],
  lookups: ParseLookups,
  options: ParseIngredientsOptions = {},
): ParsedSectionGroup[] {
  return parseGroupedIngredientLines(
    [{ title: null, lines }],
    lookups,
    options,
    true,
  );
}

/**
 * Pre-grouped variant for sources whose section boundaries are known from
 * structure (plugin HTML markup) rather than text heuristics. Lines inside a
 * trusted group are NOT run through `detectSectionHeader` — an item that
 * merely looks like a header ("Salz:", ALL-CAPS) cannot break up a group the
 * source explicitly declared. The inner expansion machinery (Optional:,
 * alternativ:, colon fallback) stays active in both modes.
 */
export function parseIngredientGroupsIntoSections(
  groups: readonly PreGroupedLines[],
  lookups: ParseLookups,
  options: ParseIngredientsOptions = {},
): ParsedSectionGroup[] {
  return parseGroupedIngredientLines(groups, lookups, options, false);
}

function parseGroupedIngredientLines(
  inputGroups: readonly PreGroupedLines[],
  lookups: ParseLookups,
  options: ParseIngredientsOptions,
  detectHeaders: boolean,
): ParsedSectionGroup[] {
  const knownUnitTokens = new Set<string>([
    ...lookups.units.byNameOrAlias.keys(),
  ]);
  const knownIngredientKeys = new Set(lookups.ingredients.keys());
  const splitOpts = {
    containerTokens: lookups.units.containerTokens,
    knownIngredients: knownIngredientKeys,
  };
  const threshold = options.autoMatchScoreThreshold ?? MIN_AUTO_MATCH_SCORE;
  const useFirstWins = options.alternativesMode === "first-wins";
  const groups: ParsedSectionGroup[] = [];

  for (const input of inputGroups) {
    // Unnamed non-first input groups continue the current section rather
    // than opening an indistinguishable second untitled one.
    if (input.title !== null || groups.length === 0) {
      groups.push({ title: input.title, ingredients: [] });
    }
    for (const rawLine of input.lines) {
      if (detectHeaders) {
        const header = detectSectionHeader(rawLine);
        if (header) {
          groups.push({ title: header, ingredients: [] });
          continue;
        }
      }
      if (!/\p{L}/u.test(rawLine)) continue;

      // Mirror parseIngredientLines: track the most recent primary emitted
      // FROM THIS INPUT LINE so unmatched alternatives fold back into it
      // rather than into a primary from a previous line. Cleared each new line.
      let lastPrimaryIndex: number | null = null;
      const originalTrimmed = rawLine.trim();
      let sourceCursor = 0;
      let pendingTailNote: string | null = null;

      for (const row of expandIngredientLine(rawLine)) {
        if (row.kind === "header") {
          groups.push({ title: row.title, ingredients: [] });
          lastPrimaryIndex = null;
          continue;
        }
        if (row.tailNote) pendingTailNote = row.tailNote;
        const raw = useFirstWins
          ? preprocessAlternatives(row.text, knownIngredientKeys)
          : row.text;
        for (const piece of splitConjunctions(raw, splitOpts)) {
          // ONE AST parse per piece — same single-pass path as
          // parseIngredientLines (quantity/unit/notes/name/match/candidates).
          const astSeg = parseSegment(piece, {
            knownUnitTokens,
            catalog: lookups.ingredientCatalog ?? [],
            catalogIndex: lookups.ingredientCatalogIndex,
            threshold,
            lineUnitId: (name, qty) =>
              resolveUnit(lookups.units, name, qty).resolved?.id ?? null,
          });
          const astNote = astSeg.notes;
          const sourceRange = findSegmentRange(
            originalTrimmed,
            piece,
            sourceCursor,
            row.isAlternative,
          );
          if (sourceRange) sourceCursor = sourceRange[1];
          if (astSeg.name.trim().length === 0) {
            // A nameless ALTERNATIVE folds into the primary's notes. A note-only
            // one (no amount/unit) qualifies the whole group; an amount-only one
            // ("1/2 large head") folds onto the primary alone.
            if (row.isAlternative && lastPrimaryIndex !== null) {
              const g = groups[groups.length - 1];
              const isNoteOnly = astSeg.quantity === null && astSeg.unitName === null;
              const foldEnd = isNoteOnly ? g.ingredients.length - 1 : lastPrimaryIndex;
              for (let ti = lastPrimaryIndex; ti <= foldEnd; ti++) {
                appendAlternativeToNotes(g.ingredients[ti], row.alternativeConnector, piece.trim(), originalTrimmed);
                if (sourceRange) {
                  (g.ingredients[ti].highlightParts ??= []).push({ range: sourceRange, kind: "note" });
                }
              }
            }
            continue;
          }
          // Defensive fallback: a colon still in the name means none of the
          // expansion rules caught this line. Use the WHOLE original input as
          // the new section title so no information is silently dropped.
          if (astSeg.name.includes(":")) {
            groups.push({ title: row.rawText, ingredients: [] });
            continue;
          }
          // Familywall opt-in: drop bare-descriptor rows — see comment in
          // {@link parseIngredientLines} for the cascade this prevents.
          if (useFirstWins && isStandaloneDescriptor(astSeg.name)) continue;
          const currentGroup = groups[groups.length - 1];
          // An optional marker on an alternative flags the whole block optional.
          if (astSeg.isOptional && row.isAlternative && lastPrimaryIndex !== null) {
            currentGroup.ingredients[lastPrimaryIndex].isOptional = true;
          }
          const leadingOr = /^(?:or|oder)\s+(.+)/i.exec(astSeg.name.trim());
          if (leadingOr && currentGroup.ingredients.length > 0) {
            const alt = leadingOr[1];
            const prev = currentGroup.ingredients[currentGroup.ingredients.length - 1];
            prev.notes = prev.notes ? `${prev.notes}, oder ${alt}` : `oder ${alt}`;
            if (astSeg.isOptional || row.forceOptional) prev.isOptional = true;
            continue;
          }
          const initialUnit = resolveUnit(
            lookups.units,
            astSeg.unitName,
            astSeg.quantity,
          );
          // See parseIngredientLines: unmatched alternatives fold back into
          // the primary's notes instead of becoming orphan new-ingredient rows.
          if (
            row.isAlternative &&
            !astSeg.matched &&
            lastPrimaryIndex !== null
          ) {
            const isNoteOnly = stripVocabTail(piece.trim()).name.trim().length === 0;
            const foldEnd = isNoteOnly ? currentGroup.ingredients.length - 1 : lastPrimaryIndex;
            for (let ti = lastPrimaryIndex; ti <= foldEnd; ti++) {
              appendAlternativeToNotes(
                currentGroup.ingredients[ti],
                row.alternativeConnector,
                piece.trim(),
                originalTrimmed,
              );
              if (sourceRange) {
                (currentGroup.ingredients[ti].highlightParts ??= []).push({
                  range: sourceRange,
                  kind: "note",
                });
              }
            }
            continue;
          }
          const final = pickFinalUnit(initialUnit, astSeg.defaultUnit, astSeg.quantity);
          currentGroup.ingredients.push({
            quantity: astSeg.quantity,
            unit: final.resolved,
            sourceRange: sourceRange ?? undefined,
            highlightParts: astHighlights(
              originalTrimmed,
              sourceRange,
              piece,
              row.alternativeConnector,
              astSeg.highlightParts,
            ),
            unitMatch: final.match,
            rawUnit: final.rawUnit,
            name: astSeg.name,
            ingredientId: astSeg.ingredientId,
            ingredientMatch: astSeg.matched ? "existing" : "new",
            canonicalIngredientName: astSeg.canonicalName,
            sourceName: astSeg.sourceName,
            notes: astNote,
            // Mirror parseIngredientLines: equipment items (Backpapier,
            // Einmachgläser …) auto-default to optional. `forceOptional`
            // carries through Optional:/alternativ:/optional-garnish-title
            // wrappers from the expansion pass.
            isOptional: astSeg.isOptional || astSeg.isEquipment || row.forceOptional,
            isAlternative: row.isAlternative,
            localNote: row.localNote,
            fixedAmount: astSeg.quantity === null,
            // Expanded rows surface the user's ORIGINAL full line so the
            // import-review UI can show where each row came from.
            rawText: row.rawText !== row.text ? row.rawText : piece.trim(),
            candidateMatches: astSeg.candidateMatches,
            newNameProposals: astSeg.newNameProposals,
          });
          if (!row.isAlternative) {
            lastPrimaryIndex = currentGroup.ingredients.length - 1;
          }
        }
      }
      if (pendingTailNote && lastPrimaryIndex !== null) {
        const primary = groups[groups.length - 1].ingredients[lastPrimaryIndex];
        appendAlternativeToNotes(primary, null, pendingTailNote, originalTrimmed);
        const idx = originalTrimmed.indexOf(pendingTailNote);
        if (idx >= 0) {
          (primary.highlightParts ??= []).push({
            range: [idx, idx + pendingTailNote.length],
            kind: "note",
          });
        }
      }
    }
  }

  if (groups.length === 0) groups.push({ title: null, ingredients: [] });
  // Drop the leading unnamed section if empty — keeps the response clean
  // when the paste starts with a section header.
  if (groups.length > 1 && groups[0].title === null && groups[0].ingredients.length === 0) {
    groups.shift();
  }
  for (const g of groups) applyAlternativeInheritance(g.ingredients);
  return groups;
}

export type ParsedInstructionGroup = {
  title: string | null;
  lines: string[];
};

/**
 * Split a list of instruction steps into groups by section header
 * ("Für den Teig:", "FÜR DIE FÜLLUNG", "Part 1: Sauce"). Mirrors the
 * ingredient-side splitter so titles match by string identity and the
 * caller can pair them up section-by-section.
 */
export function parseInstructionsIntoSections(
  lines: readonly string[],
): ParsedInstructionGroup[] {
  const groups: ParsedInstructionGroup[] = [{ title: null, lines: [] }];
  for (const raw of lines) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const header = detectSectionHeader(trimmed);
    if (header) {
      groups.push({ title: header, lines: [] });
      continue;
    }
    groups[groups.length - 1].lines.push(trimmed);
  }
  if (groups.length > 1 && groups[0].title === null && groups[0].lines.length === 0) {
    groups.shift();
  }
  return groups;
}

/**
 * Match instruction groups to ingredient groups by title (case- and
 * diacritic-insensitive) and emit per-section instructions. Instruction
 * groups without a matching ingredient title become their own
 * ingredient-less section. Leading unnamed instructions get attached to
 * the first ingredient section so a recipe that starts with a prep step
 * and then has "Für den Teig:" still gets all instructions in the right
 * order.
 *
 * `joinFn` controls how step lines are rendered into the section's
 * instructions string (each importer can format differently — Familywall
 * uses numbered ordered-list markdown, URL imports keep the source's
 * structure).
 */
export function mergeIngredientAndInstructionSections(
  ingredientGroups: readonly ParsedSectionGroup[],
  instructionGroups: readonly ParsedInstructionGroup[],
  joinFn: (lines: string[]) => string,
): Array<{
  title: string | null;
  ingredients: ImportedIngredient[];
  instructions: string;
}> {
  function keyOf(t: string | null): string | null {
    return t == null ? null : normalizeForMatch(t);
  }

  const remaining = new Map<string | null, string[]>();
  // When multiple instruction groups share a normalized title (rare), the
  // first wins; the rest accumulate into the same key so nothing is lost.
  for (const g of instructionGroups) {
    const k = keyOf(g.title);
    const existing = remaining.get(k);
    if (existing) existing.push(...g.lines);
    else remaining.set(k, [...g.lines]);
  }

  const merged: Array<{
    title: string | null;
    ingredients: ImportedIngredient[];
    instructions: string;
  }> = [];
  for (const ig of ingredientGroups) {
    const k = keyOf(ig.title);
    const lines = remaining.get(k);
    if (lines) remaining.delete(k);
    merged.push({
      title: ig.title,
      ingredients: ig.ingredients,
      instructions: joinFn(lines ?? []),
    });
  }

  // Instructions whose title didn't match any ingredient section.
  // Attach unnamed leftovers to the first section's instructions
  // (prepend) so they read in document order. Named leftovers become
  // their own sections with empty ingredients.
  for (const [k, lines] of remaining) {
    if (lines.length === 0) continue;
    if (k === null) {
      if (merged.length === 0) {
        merged.push({ title: null, ingredients: [], instructions: joinFn(lines) });
      } else {
        const head = merged[0];
        head.instructions = [joinFn(lines), head.instructions]
          .filter((s) => s.length > 0)
          .join("\n");
      }
      continue;
    }
    const originalTitle =
      instructionGroups.find((g) => keyOf(g.title) === k)?.title ?? null;
    merged.push({
      title: originalTitle,
      ingredients: [],
      instructions: joinFn(lines),
    });
  }
  return merged;
}

function instructionsToMarkdown(steps: string[]): string {
  if (steps.length === 0) return "";
  if (steps.length === 1) return steps[0];
  return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

function pickResolvedImageUrl(
  recipe: JsonLdRecipe,
  baseUrl: string,
): URL | null {
  const raw = asImageUrl(recipe.image);
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl);
  } catch {
    return null;
  }
}

export async function downloadAndStoreImage(
  imgUrl: URL,
): Promise<PhotoPath | null> {
  try {
    const result = await fetchUrl(imgUrl.toString(), {
      accept: "image/*",
      timeoutMs: 20_000,
      // Allow a generous size since recipe hero photos can be large.
      maxBytes: 15 * 1024 * 1024,
    });
    return await savePhotoBuffer(result.body);
  } catch {
    // Failing to fetch the image shouldn't abort the whole import — the user
    // can attach a photo manually after.
    return null;
  }
}

function pickTags(recipe: JsonLdRecipe): string[] {
  const out = new Set<string>();
  const add = (raw: unknown) => {
    if (typeof raw === "string") {
      for (const t of raw.split(/[,;]/)) {
        const trimmed = t.trim();
        if (trimmed.length > 0 && trimmed.length <= 40) out.add(trimmed);
      }
    } else if (Array.isArray(raw)) {
      for (const r of raw) add(r);
    }
  };
  add(recipe.keywords);
  add(recipe.recipeCategory);
  add(recipe.recipeCuisine);
  return Array.from(out).slice(0, 12);
}

/**
 * Build ingredient + instruction section groups for a URL import from the
 * two available signals:
 *
 * - Ingredients: schema.org has no group concept, so boundaries come from
 *   recipe-plugin HTML markup when present. The JSON-LD strings stay
 *   canonical — HTML contributes titles and counts only, and only when the
 *   counts line up exactly. Otherwise: the flat text-heuristic path.
 * - Instructions: JSON-LD `HowToSection` names are authoritative when
 *   present. Otherwise the extracted step lines run through the
 *   text-heuristic header splitter ("Für den Teig:", ALL-CAPS headers
 *   hiding inside the step list), as before.
 */
export function buildImportSections(
  recipe: JsonLdRecipe,
  html: string,
  lookups: ParseLookups,
): {
  ingredientGroups: ParsedSectionGroup[];
  instructionGroups: ParsedInstructionGroup[];
} {
  const ingredientStrings = asStringList(recipe.recipeIngredient);
  const htmlGroups = extractIngredientGroupsFromHtml(html);
  const aligned = htmlGroups
    ? alignHtmlGroupsToLines(htmlGroups, ingredientStrings)
    : null;
  const ingredientGroups = aligned
    ? parseIngredientGroupsIntoSections(aligned, lookups)
    : parseIngredientLinesIntoSections(ingredientStrings, lookups);

  const rawInstructionGroups = asInstructionGroups(recipe.recipeInstructions);
  // A LONE titled section ("Zubereitung", "Instructions") is just the card's
  // step heading, not real grouping — chefkoch wraps all steps that way.
  // Demote it to the flat path unless it names an ingredient group, so the
  // steps attach to the ingredient section instead of splitting off.
  const lone = rawInstructionGroups.length === 1 ? rawInstructionGroups[0] : null;
  const loneGenericTitle =
    lone?.title != null &&
    !ingredientGroups.some(
      (g) =>
        g.title !== null &&
        normalizeForMatch(g.title) === normalizeForMatch(lone.title!),
    );
  const instructionGroups: ParsedInstructionGroup[] =
    rawInstructionGroups.some((g) => g.title !== null) && !loneGenericTitle
      ? rawInstructionGroups
      : parseInstructionsIntoSections(
          rawInstructionGroups.flatMap((g) => g.lines),
        );

  return { ingredientGroups, instructionGroups };
}

export async function importRecipeFromUrl(
  rawUrl: string,
): Promise<ImportedRecipe> {
  let fetched;
  try {
    fetched = await fetchUrl(rawUrl);
  } catch (e) {
    throw new ImportError(
      e instanceof FetchError ? e.message : "Seite konnte nicht geladen werden",
      "fetch",
    );
  }

  const html = fetched.body.toString("utf8");
  const recipe = extractJsonLdRecipe(html);
  if (!recipe) {
    throw new ImportError(
      "Keine maschinenlesbaren Rezeptdaten (schema.org/Recipe) gefunden.",
      "noRecipe",
    );
  }

  const title = asString(recipe.name) ?? "Importiertes Rezept";
  const description = asString(recipe.description);
  const servings = asServings(recipe.recipeYield);

  let prepTimeMin = parseIsoDurationToMinutes(recipe.prepTime);
  const cookTimeMin = parseIsoDurationToMinutes(recipe.cookTime);
  const totalTimeMin = parseIsoDurationToMinutes(recipe.totalTime);
  // If only totalTime is given, attribute it to prepTime so it shows up
  // somewhere; the user can re-distribute.
  if (prepTimeMin === null && cookTimeMin === null && totalTimeMin !== null) {
    prepTimeMin = totalTimeMin;
  }

  const unitLookup = buildUnitLookup();
  const ingredientLookup = buildIngredientLookup();
  const ingredientCatalog = buildIngredientCatalog();

  // Section-aware: structural signals first (plugin HTML ingredient groups,
  // JSON-LD HowToSection names), text heuristics as fallback. Matching
  // titles land in the same merged section; see buildImportSections.
  const { ingredientGroups, instructionGroups } = buildImportSections(
    recipe,
    html,
    {
      units: unitLookup,
      ingredients: ingredientLookup,
      ingredientCatalog,
    },
  );
  const merged = mergeIngredientAndInstructionSections(
    ingredientGroups,
    instructionGroups,
    instructionsToMarkdown,
  );

  let photoPath: string | null = null;
  const imageUrl = pickResolvedImageUrl(recipe, fetched.url);
  if (imageUrl) {
    photoPath = await downloadAndStoreImage(imageUrl);
  }

  return {
    title,
    description,
    servings,
    prepTimeMin,
    cookTimeMin,
    sourceUrl: fetched.url,
    photoPath,
    tags: pickTags(recipe),
    sections:
      merged.length > 0
        ? merged
        : [{ title: null, instructions: "", ingredients: [] }],
  };
}
