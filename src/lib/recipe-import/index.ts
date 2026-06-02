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
  asServings,
  asString,
  asStringList,
  extractJsonLdRecipe,
  type JsonLdRecipe,
} from "./json-ld.ts";
import { parseIsoDurationToMinutes } from "./duration.ts";
import {
  detectSectionHeader,
  expandIngredientLine,
  isPrepLeadingToken,
  normalizeForMatch,
  parseIngredientString,
  isStandaloneDescriptor,
  preprocessAlternatives,
  splitConjunctions,
  tokenizeEntryNameForCatalog,
  type ParsedIngredient,
} from "./ingredient.ts";
import {
  findIngredientCandidates,
  MIN_AUTO_MATCH_SCORE,
  tokenizeCandidate,
  type CandidateToken,
  type CatalogBlockIndex,
  type IngredientCandidateMatch,
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
  // Terminal fallback for an entry's resolved matching unit (alias default →
  // ingredient default → global default). Read once per build.
  const globalDefaultUnitId = getGlobalDefaultUnitId() ?? undefined;
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
      // Resolved matching unit: ingredient default → global default.
      unitId: i.defaultUnitId ?? globalDefaultUnitId,
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
      // Resolved matching unit: alias default → ingredient default → global.
      unitId: a.defaultUnitId ?? a.ingredientDefaultUnitId ?? globalDefaultUnitId,
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

/**
 * Parse a batch of raw ingredient strings into the same shape `importRecipeFromUrl`
 * returns. Used by both the URL importer and the clipboard-paste endpoint.
 */
/**
 * Decide between the full parsed name and the prep-stripped alternative.
 * Rules:
 *   - container present in the line ⇒ use full name (no strip). The trailing
 *     adjective is part of the canned/jarred product name.
 *   - full name matches an existing ingredient/alias ⇒ use full name.
 *   - alternative available ⇒ use it (strip leading prep adjectives to notes).
 *   - otherwise ⇒ use full name unchanged.
 */
function pickNameAndNotes(
  rawLine: string,
  parsed: ParsedIngredient,
  ingredientLookup: IngredientLookup,
  containerTokens: ReadonlySet<string>,
): { name: string; notes: string | null } {
  const hasContainer = lineContainsToken(rawLine, containerTokens);
  if (hasContainer) {
    return { name: parsed.name, notes: parsed.notes };
  }
  const fullMatch = ingredientLookup.has(parsed.name.toLowerCase());
  if (fullMatch) {
    return { name: parsed.name, notes: parsed.notes };
  }
  if (parsed.altWithPrepStripped) {
    return parsed.altWithPrepStripped;
  }
  return { name: parsed.name, notes: parsed.notes };
}

function lineContainsToken(
  line: string,
  tokens: ReadonlySet<string>,
): boolean {
  if (tokens.size === 0) return false;
  const parts = line.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  for (const p of parts) {
    if (tokens.has(p)) return true;
  }
  return false;
}

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
 * Derive a row's display name + notes from a matched alias. The name is the
 * matched catalog alias verbatim (`aliasName`) — a curated string, so it's
 * clean and consistent regardless of how the source was spelled or tokenised
 * ("extra-virgin olive oil", not "extra virgin …"; "TK Erbsen", not the source
 * order "Erbsen TK"). Notes are EVERY input token the alias didn't cover —
 * before, interior ("bell" in a "red bell pepper" hit on "red pepper"), and
 * after the matched span — plus the parser's base notes (parens / brackets /
 * usage / range / "to taste"), with the comma-tail content subtracted so
 * post-comma tokens aren't double-counted.
 */
function computeNameAndNotes(
  parsed: ParsedIngredient,
  candidate: CandidateToken[],
  coveredCandidateTokens: number[],
  aliasName: string,
): { name: string; notes: string | null; sourceName: string | null } {
  if (coveredCandidateTokens.length === 0) {
    return { name: parsed.name, notes: parsed.notes, sourceName: parsed.name };
  }
  // The display name is the matched catalog alias verbatim — a curated string,
  // so it's clean and consistent (no tokenisation artefacts like "extra virgin"
  // for a "extra-virgin" source). Every input token the alias didn't cover —
  // leading, interior ("bell" in "red bell pepper" → "red pepper"), or
  // trailing — falls through to the notes below.
  const name = aliasName;
  // The original SOURCE span the alias replaced (first→last covered token,
  // space-joined; internal commas kept when the alias itself carries one).
  // Surfaced so the UI can offer "keep my spelling and remember it as an
  // alias" instead of the parser's substituted name.
  const lo = Math.min(...coveredCandidateTokens);
  const hi = Math.max(...coveredCandidateTokens);
  const keepCommas = aliasName.includes(",");
  let sourceName = candidate[lo].raw;
  for (let k = lo + 1; k <= hi; k++) {
    sourceName +=
      (keepCommas && candidate[k].precededByComma ? ", " : " ") +
      candidate[k].raw;
  }
  sourceName = sourceName.replace(/\s+/g, " ").trim();
  // Reassemble notes in SOURCE order:
  //   leadingNotes (range/size, front)
  //   → the name area walked left-to-right, emitting the descriptor runs the
  //     match DIDN'T take and the in-line paren notes at their recorded
  //     position (so "…peanut butter-no sugar added (crunchy…) see notes" →
  //     "no sugar added, crunchy…, see notes")
  //   → post-comma notes (comma-tail + later parens), minus any comma-tail the
  //     match folded into the name
  //   → trailingNotes (hoisted brackets / "to taste")
  const covered = new Set(coveredCandidateTokens);
  const preCommaCount = candidate.filter((t) => !t.postComma).length;
  // In-line paren notes grouped by their (clamped) name-token position.
  const notesAtPos = new Map<number, string[]>();
  for (const n of parsed.nameAreaNotes) {
    // Re-tokenise the recorded name prefix the SAME way as the match
    // candidate so the position lands in candidate-token space (the parser
    // and the matcher split dashes differently).
    const pos = Math.min(tokenizeCandidate(n.afterText).length, preCommaCount);
    const list = notesAtPos.get(pos) ?? [];
    list.push(n.text);
    notesAtPos.set(pos, list);
  }
  const nameAreaFragments: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const run = buffer.join(" ").trim();
    if (run.length > 0) nameAreaFragments.push(run);
    buffer = [];
  };
  for (let j = 0; j <= preCommaCount; j++) {
    const atPos = notesAtPos.get(j);
    if (atPos) {
      flush();
      for (const t of atPos) nameAreaFragments.push(t);
    }
    if (j === preCommaCount) break;
    if (covered.has(j)) flush();
    else buffer.push(candidate[j].raw);
  }
  flush();
  // Comma-tail tokens the match folded into the name → drop from postComma.
  const coveredCommaTail = candidate
    .filter((t, i) => t.postComma && covered.has(i))
    .map((t) => t.raw)
    .join(" ")
    .trim();
  const postComma =
    coveredCommaTail.length > 0
      ? subtractCommaTail(parsed.postCommaNotes, coveredCommaTail)
      : parsed.postCommaNotes;
  const notes =
    [
      ...parsed.leadingNotes,
      ...nameAreaFragments,
      postComma ?? "",
      ...parsed.trailingNotes,
    ]
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join(", ") || null;
  return { name, notes, sourceName };
}

/**
 * Run the structural matcher against the candidate text (parsed name + the
 * comma-tail content, joined with a COMMA so the tail is flagged post-comma).
 * When a match clears the threshold, its matched span becomes the row's
 * name and everything outside it becomes notes (see {@link computeNameAndNotes}).
 * When nothing matches, fall back to the conservatively-cleaned name —
 * prep-strip + comma-tail-identity cleanup, the ONLY place word-lists still
 * apply — so the new-ingredient row gets a sensible name.
 */
function resolveIngredientForRow(
  parsed: ParsedIngredient,
  rawLine: string,
  lookups: ParseLookups,
  autoMatchScoreThreshold: number,
): {
  name: string;
  /** Combined notes — what the parser pre-extracted (parens, brackets, "to
   *  taste", etc.) plus anything the matcher's uncovered tokens contributed
   *  / the cleanup helper stripped. */
  notes: string | null;
  ingredientId: number | null;
  match: IngredientMatch;
  canonicalIngredientName: string | null;
  /** The original source span the matched alias replaced ("Zwiebeln" when the
   *  alias-name became "Zwiebel"). Null on the new-ingredient path. Lets the
   *  UI offer the user's own spelling as the alias to remember. */
  sourceName: string | null;
  candidateMatches: ImportedCandidateMatch[];
  newNameProposals: ImportedNameProposal[];
  /** Default unit attached to the resolved alias entry, if any. */
  defaultUnit: { id: number; name: string } | null;
  /** True when the matched ingredient is flagged as equipment — the caller
   *  ORs this into the row's `isOptional` so equipment items default to
   *  optional on every recipe row. */
  isEquipment: boolean;
} {
  const catalog = lookups.ingredientCatalog;
  // Single matcher pass over the wide text (name + comma-tail joined with a
  // COMMA, so tail tokens are flagged post-comma and discounted). Returns ALL
  // ranked matches; the pill UI surfaces the below-threshold ones too.
  let wideMatches: IngredientCandidateMatch[] = [];
  if (catalog && catalog.length > 0) {
    const wideText = [parsed.name, parsed.commaTailText]
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join(", ");
    if (wideText.length > 0) {
      // Resolve the line's unit so the matcher can use it as the decider:
      // among gate-clearers, a candidate whose resolved unit matches the line's
      // wins (canned "Dose" vs fresh "Stück"). Gated on the undoubled score, so
      // the unit can't crash the auto-match gate.
      const lineUnitId =
        resolveUnit(lookups.units, parsed.unitName, parsed.quantity).resolved?.id ??
        null;
      const { matches } = findIngredientCandidates(wideText, catalog, {
        lineUnitId,
        gateScore: autoMatchScoreThreshold,
        index: lookups.ingredientCatalogIndex,
      });
      wideMatches = matches;
      const top = matches[0];
      if (top && top.score >= autoMatchScoreThreshold) {
        // Name = the matched span; everything outside it → notes. The
        // shopping-list aggregator keys off `ingredientId` so cross-language
        // merging ("tomatoes" + "Tomate") still happens while the recipe
        // keeps the user's source spelling for the matched span.
        const { name, notes, sourceName } = computeNameAndNotes(
          parsed,
          top.candidate,
          top.coveredCandidateTokens,
          top.aliasName,
        );
        // Per-alias rename: when the matched alias configures a display name
        // ("Knoblauchzehe" → "Knoblauch"), the row shows that instead of the
        // alias text — the unit (e.g. the alias's default "Zehe") is rendered
        // separately, so the line reads "3 Zehen Knoblauch". Notes from the
        // uncovered tokens are kept. NULL display name → alias verbatim.
        const displayName = top.displayName?.trim() || name;
        const canonical =
          displayName.toLowerCase() === top.canonicalName.toLowerCase()
            ? null
            : top.canonicalName;
        return {
          name: displayName,
          notes,
          ingredientId: top.ingredientId,
          match: "existing",
          canonicalIngredientName: canonical,
          sourceName,
          candidateMatches: matches.map((m) =>
            toImportedCandidateMatch(m, parsed),
          ),
          newNameProposals: [],
          defaultUnit: top.defaultUnit ?? null,
          isEquipment: top.isEquipment ?? false,
        };
      }
    }
  }

  // Nothing above threshold → create a new ingredient. Word-lists live ONLY
  // here: prep-strip + comma-tail-identity cleanup produce a tidy new name
  // ("frischer Spargel" → "Spargel", note "frischer" when Spargel isn't in
  // the catalog). When the comma-tail content is part of the user's identity
  // (not all prep-like), fold it back into the new ingredient's NAME so
  // "Paprikapulver, edelsüß" and "Paprikapulver edelsüß" create the same
  // ingredient. Otherwise the comma-tail stays as notes.
  const cleaned = pickNameAndNotes(
    rawLine,
    parsed,
    lookups.ingredients,
    lookups.units.containerTokens,
  );
  const commaTailIsAllPrepLike =
    parsed.commaTailText.trim().length > 0 &&
    isAllPrepLikeText(parsed.commaTailText);
  const newName =
    parsed.commaTailText.trim().length > 0 && !commaTailIsAllPrepLike
      ? commaTailGoesAsPrefix(parsed.commaTailText)
        ? [parsed.commaTailText, cleaned.name].map((s) => s.trim()).join(" ")
        : [cleaned.name, parsed.commaTailText].map((s) => s.trim()).join(" ")
      : cleaned.name;
  const newNotes =
    parsed.commaTailText.trim().length > 0 && !commaTailIsAllPrepLike
      ? subtractCommaTail(cleaned.notes, parsed.commaTailText)
      : cleaned.notes;
  const proposals: ImportedNameProposal[] = [];
  proposals.push({
    name: newName,
    notes: newNotes,
    label: "Aufgeräumt",
  });
  if (newName.toLowerCase() !== parsed.name.toLowerCase()) {
    proposals.push({
      name: parsed.name,
      notes: parsed.notes,
      label: "Wie eingegeben",
    });
  }
  return {
    name: newName,
    notes: newNotes,
    ingredientId: null,
    match: "new",
    canonicalIngredientName: null,
    sourceName: null,
    candidateMatches: wideMatches.map((m) =>
      toImportedCandidateMatch(m, parsed),
    ),
    newNameProposals: proposals,
    defaultUnit: null,
    isEquipment: false,
  };
}

function toImportedCandidateMatch(
  m: IngredientCandidateMatch,
  parsed: ParsedIngredient,
): ImportedCandidateMatch {
  const { name, notes } = computeNameAndNotes(
    parsed,
    m.candidate,
    m.coveredCandidateTokens,
    m.aliasName,
  );
  return {
    ingredientId: m.ingredientId,
    canonicalName: m.canonicalName,
    matchedName: m.aliasName,
    score: m.score,
    name,
    notes,
    isEquipment: m.isEquipment ?? false,
  };
}

/** Conjunctions that link prep words ("peeled AND deveined") — ignored when
 *  deciding whether a comma-tail is all prep-like, but kept in the notes. */
const PREP_CONJUNCTIONS = new Set(["and", "und", "&", "or", "oder"]);

/**
 * True when the meaningful tokens in `text` are ALL prep-like words
 * (PREP_LEADING_TOKENS or SIZE_MODIFIER_TOKENS — "klein", "gehackt", "fein",
 * …). Linking conjunctions ("and"/"und") are ignored so "peeled and
 * deveined" still reads as all-prep. The new-ingredient naming path uses this
 * to decide whether the comma-tail is a note ("Tomaten, klein gehackt" →
 * notes) or part of the identity ("Paprikapulver, edelsüß" → name).
 */
function isAllPrepLikeText(text: string): boolean {
  const tokens = text
    .split(/[\s,;]+/)
    .map((t) => t.replace(/[.,;]$/, ""))
    .filter((t) => t.length > 0);
  const meaningful = tokens.filter(
    (t) => !PREP_CONJUNCTIONS.has(t.toLowerCase()),
  );
  if (meaningful.length === 0) return false;
  return meaningful.every((t) => isPrepLeadingToken(t));
}

/**
 * Whether the comma-tail content reads more naturally as a PREFIX to the
 * ingredient name than as a suffix. Used when folding non-prep comma-tail
 * content back into a new ingredient's name:
 *   "Erbsen, TK"          → "TK Erbsen"       (prefix — TK is an abbrev)
 *   "Paprikapulver, edelsüß" → "Paprikapulver edelsüß" (suffix — descriptor)
 * Heuristic: a single token that's ≤3 characters long OR entirely upper-
 * case (matches abbreviations like "TK", "BBQ", "Bio") goes in front.
 * Multi-token or longer-lowercase comma-tails stay at the end, preserving
 * the user's original word order.
 */
function commaTailGoesAsPrefix(commaTailText: string): boolean {
  const tokens = commaTailText
    .trim()
    .split(/[\s,;]+/)
    .filter((t) => t.length > 0);
  if (tokens.length !== 1) return false;
  const t = tokens[0];
  if (t.length <= 3) return true;
  if (t === t.toUpperCase() && /\p{Lu}/u.test(t)) return true;
  return false;
}

/**
 * Remove the comma-tail run from a notes string once, so content folded into
 * a new-ingredient name doesn't also linger as a note. Matches the comma-tail
 * as a whole run between separators; best-effort verbatim (untouched when the
 * comma-tail isn't present).
 */
function subtractCommaTail(
  notes: string | null,
  commaTailText: string,
): string | null {
  if (!notes) return null;
  const trimmed = commaTailText.trim();
  if (trimmed.length === 0) return notes;
  const re = new RegExp(
    `(^|,\\s*)${trimmed.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(?=,\\s*|$)`,
    "i",
  );
  const cleaned = notes
    .replace(re, "")
    .replace(/^,\s*|,\s*$/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

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
    aliasDefaultUnit
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

    for (const row of expandIngredientLine(rawLine)) {
      if (row.kind === "header") continue;
      // Familywall opt-in: pre-resolve "X oder Y" alternatives + adjacent-pair
      // conjunctions (Salz Pfeffer) before the conjunction splitter runs.
      const raw = useFirstWins
        ? preprocessAlternatives(row.text, knownIngredientKeys)
        : row.text;
      for (const piece of splitConjunctions(raw, splitOpts)) {
        const parsed = parseIngredientString(piece, knownUnitTokens);
        // Skip the row when the parser couldn't pull a real ingredient name
        // out of the line. Familywall data legitimately has entries like
        // "2 Prise" / "200 g" / "5-7 EL" with no ingredient — there's nothing
        // useful to import, and falling back to the raw piece would create
        // a garbage row in the global ingredient catalog ("2 Prise" as an
        // ingredient). Same for fragments produced by conjunction splitting
        // that turn out to be empty.
        if (parsed.name.trim().length === 0) continue;
        // Defensive: a colon still in the parsed name means none of the
        // expansion rules caught the line. Drop rather than pollute the
        // catalog with a colon-bearing ingredient name.
        if (parsed.name.includes(":")) continue;
        // Familywall opt-in: drop rows whose name is a bare descriptor token
        // ("frische", "fresh", "red") with no head noun — usually truncated
        // source lines like "8 frische" or "1 cup fresh". Without this, the
        // first such row creates a "frische" canonical and subsequent
        // "frische X" lines tie at score 130 between the orphan and the real
        // head-noun canonical, cascading more orphan matches.
        if (useFirstWins && isStandaloneDescriptor(parsed.name)) continue;
        // A leading "or X" / "oder X" almost always means we just split a
        // conjunction that connected alternatives. Attach as a note on the
        // previous row instead of creating a separate ingredient.
        const leadingOr = /^(?:or|oder)\s+(.+)/i.exec(parsed.name.trim());
        if (leadingOr && out.length > 0) {
          const alt = leadingOr[1];
          const prev = out[out.length - 1];
          prev.notes = prev.notes ? `${prev.notes}, oder ${alt}` : `oder ${alt}`;
          if (parsed.isOptional || row.forceOptional) prev.isOptional = true;
          continue;
        }
        const initialUnit = resolveUnit(
          lookups.units,
          parsed.unitName,
          parsed.quantity,
        );
        const resolved = resolveIngredientForRow(parsed, piece, lookups, threshold);
        // Fold an unmatched alternative back into its primary's notes instead
        // of creating an "orphan new-ingredient" row. Most recipe "or"s mean
        // "or you could use this instead" rather than a parallel shopping
        // entry — when the catalog doesn't recognise the alternative, the
        // user's intent is information for the cook, not a second purchase.
        if (
          row.isAlternative &&
          resolved.match === "new" &&
          lastPrimaryIndex !== null
        ) {
          appendAlternativeToNotes(
            out[lastPrimaryIndex],
            row.alternativeConnector,
            piece.trim(),
          );
          continue;
        }
        const final = pickFinalUnit(initialUnit, resolved.defaultUnit);
        out.push({
          quantity: parsed.quantity,
          unit: final.resolved,
          unitMatch: final.match,
          rawUnit: final.rawUnit,
          name: resolved.name,
          ingredientId: resolved.ingredientId,
          ingredientMatch: resolved.match,
          canonicalIngredientName: resolved.canonicalIngredientName,
          sourceName: resolved.sourceName,
          notes: resolved.notes,
          // Equipment-flagged ingredients (Backpapier, Einmachgläser …)
          // default to optional so the user decides per-recipe whether they
          // actually need to shop them. `forceOptional` carries through
          // Optional:/alternativ: wrappers from the expansion pass.
          isOptional: parsed.isOptional || resolved.isEquipment || row.forceOptional,
          isAlternative: row.isAlternative,
          // No parsed quantity → treat the amount as constant. Catches
          // "Salz nach Geschmack" / "etwas Olivenöl" so changing the meal's
          // portion size doesn't multiply a non-existent number.
          fixedAmount: parsed.quantity === null,
          // For expanded rows (Optional:, alternativ:, list-after-colon,
          // each:), surface the user's ORIGINAL full line in rawText —
          // makes it clear in the import-review UI which source line each
          // resulting ingredient came from.
          rawText: row.rawText !== row.text ? row.rawText : piece.trim(),
          candidateMatches: resolved.candidateMatches,
          newNameProposals: resolved.newNameProposals,
        });
        if (!row.isAlternative) lastPrimaryIndex = out.length - 1;
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
): void {
  const fragment = connector
    ? `${connector} ${altText}`.trim()
    : altText.trim();
  if (fragment.length === 0) return;
  target.notes = target.notes ? `${target.notes}, ${fragment}` : fragment;
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

function inheritWithinGroup(
  rows: ImportedIngredient[],
  lo: number,
  hi: number,
): void {
  const primary = rows[lo];
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
  }
  // Trailing note of the last member → siblings that have none of their own.
  const sharedNote = rows[hi].notes?.trim();
  if (sharedNote && sharedNote.length > 0) {
    for (let k = lo; k < hi; k++) {
      const cur = rows[k].notes?.trim();
      // Only siblings that brought no note of their own inherit the shared
      // prep — one that kept its own ("1 onion, finely chopped, or 2 shallots,
      // diced") keeps it on both the row and its candidates.
      if (cur && cur.length > 0) continue;
      rows[k].notes = sharedNote;
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
  const groups: ParsedSectionGroup[] = [{ title: null, ingredients: [] }];

  for (const rawLine of lines) {
    const header = detectSectionHeader(rawLine);
    if (header) {
      groups.push({ title: header, ingredients: [] });
      continue;
    }
    if (!/\p{L}/u.test(rawLine)) continue;

    // Mirror parseIngredientLines: track the most recent primary emitted
    // FROM THIS INPUT LINE so unmatched alternatives fold back into it
    // rather than into a primary from a previous line. Cleared each new line.
    let lastPrimaryIndex: number | null = null;

    for (const row of expandIngredientLine(rawLine)) {
      if (row.kind === "header") {
        groups.push({ title: row.title, ingredients: [] });
        lastPrimaryIndex = null;
        continue;
      }
      const raw = useFirstWins
        ? preprocessAlternatives(row.text, knownIngredientKeys)
        : row.text;
      for (const piece of splitConjunctions(raw, splitOpts)) {
        const parsed = parseIngredientString(piece, knownUnitTokens);
        if (parsed.name.trim().length === 0) continue;
        // Defensive fallback: a colon still in the parsed name means none
        // of the expansion rules above caught this line. Use the WHOLE
        // original input as the new section title so no information is
        // silently dropped on its way through the parser.
        if (parsed.name.includes(":")) {
          groups.push({ title: row.rawText, ingredients: [] });
          continue;
        }
        // Familywall opt-in: drop bare-descriptor rows — see comment in
        // {@link parseIngredientLines} for the cascade this prevents.
        if (useFirstWins && isStandaloneDescriptor(parsed.name)) continue;
        const currentGroup = groups[groups.length - 1];
        const leadingOr = /^(?:or|oder)\s+(.+)/i.exec(parsed.name.trim());
        if (leadingOr && currentGroup.ingredients.length > 0) {
          const alt = leadingOr[1];
          const prev = currentGroup.ingredients[currentGroup.ingredients.length - 1];
          prev.notes = prev.notes ? `${prev.notes}, oder ${alt}` : `oder ${alt}`;
          if (parsed.isOptional || row.forceOptional) prev.isOptional = true;
          continue;
        }
        const initialUnit = resolveUnit(
          lookups.units,
          parsed.unitName,
          parsed.quantity,
        );
        const resolved = resolveIngredientForRow(parsed, piece, lookups, threshold);
        // See parseIngredientLines: unmatched alternatives fold back into
        // the primary's notes instead of becoming orphan new-ingredient rows.
        if (
          row.isAlternative &&
          resolved.match === "new" &&
          lastPrimaryIndex !== null
        ) {
          appendAlternativeToNotes(
            currentGroup.ingredients[lastPrimaryIndex],
            row.alternativeConnector,
            piece.trim(),
          );
          continue;
        }
        const final = pickFinalUnit(initialUnit, resolved.defaultUnit);
        currentGroup.ingredients.push({
          quantity: parsed.quantity,
          unit: final.resolved,
          unitMatch: final.match,
          rawUnit: final.rawUnit,
          name: resolved.name,
          ingredientId: resolved.ingredientId,
          ingredientMatch: resolved.match,
          canonicalIngredientName: resolved.canonicalIngredientName,
          sourceName: resolved.sourceName,
          notes: resolved.notes,
          // Mirror parseIngredientLines: equipment items (Backpapier,
          // Einmachgläser …) auto-default to optional. `forceOptional`
          // carries through Optional:/alternativ:/optional-garnish-title
          // wrappers from the expansion pass.
          isOptional: parsed.isOptional || resolved.isEquipment || row.forceOptional,
          isAlternative: row.isAlternative,
          fixedAmount: parsed.quantity === null,
          // Expanded rows surface the user's ORIGINAL full line so the
          // import-review UI can show where each row came from.
          rawText: row.rawText !== row.text ? row.rawText : piece.trim(),
          candidateMatches: resolved.candidateMatches,
          newNameProposals: resolved.newNameProposals,
        });
        if (!row.isAlternative) {
          lastPrimaryIndex = currentGroup.ingredients.length - 1;
        }
      }
    }
  }

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

  const ingredientStrings = asStringList(recipe.recipeIngredient);
  const unitLookup = buildUnitLookup();
  const ingredientLookup = buildIngredientLookup();
  const ingredientCatalog = buildIngredientCatalog();

  // Section-aware: ingredients and instructions both get split on shared
  // section headers ("Für den Teig:", "FÜR DIE FÜLLUNG"). Matching titles
  // land in the same merged section. Unmatched leftovers either prepend
  // to the first section (unnamed lead-in) or become their own ingredient-
  // less sections (named).
  const ingredientGroups = parseIngredientLinesIntoSections(ingredientStrings, {
    units: unitLookup,
    ingredients: ingredientLookup,
    ingredientCatalog,
  });
  const instructionGroups = parseInstructionsIntoSections(
    asStringList(recipe.recipeInstructions),
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
