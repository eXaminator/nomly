import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  ingredient,
  ingredientAlias,
  ingredientSubUnit,
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
  type ParsedIngredient,
} from "./ingredient.ts";
import {
  findIngredientCandidates,
  MIN_AUTO_MATCH_SCORE,
  tokenizeCandidate,
  type IngredientCandidateMatch,
  type IngredientCatalog,
} from "./matching.ts";
import { savePhotoBuffer, type PhotoPath } from "../photos.ts";

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

export type SubUnitRef = {
  id: number;
  name: string;
  perPurchase: number;
};

export type ImportedIngredient = {
  quantity: number | null;
  /** Best-effort resolved unit. `id` null when we couldn't match anything OR
   *  when the row resolved to a sub-unit (see {@link subUnit}); the UI uses
   *  {@link unitMatch} + {@link rawUnit} to render appropriately. */
  unit: { id: number; name: string } | null;
  /** Set when the parser resolved the row to an ingredient-scoped sub-unit
   *  ("Zehe" for Knoblauch). Mutually exclusive with `unit` — when this is
   *  populated, `unit` is null. */
  subUnit: SubUnitRef | null;
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
  /** Raw text of candidate tokens NOT covered by this match — e.g. "rote"
   *  for candidate "Paprikaschote rote" matched against "Paprikaschoten".
   *  Empty when the match covers everything. The pill UI uses this to move
   *  uncovered tokens out of the name input and into the notes field when
   *  the user manually picks a low-confidence match. */
  uncoveredText: string;
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
  /**
   * Lowercased tokens (canonical names + aliases) of units flagged as
   * containers. The parser uses this set to suppress conjunction-splitting
   * and prep-word stripping when a container is present.
   */
  containerTokens: Set<string>;
};

export function buildUnitLookup(): UnitLookup {
  const byNameOrAlias = new Map<string, UnitLookupEntry>();
  const byCanonicalName = new Map<string, UnitLookupEntry>();
  const containerTokens = new Set<string>();
  const canonical = db
    .select({
      id: unit.id,
      name: unit.name,
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
    if (u.isContainer) containerTokens.add(lower);
  }
  const aliases = db
    .select({
      id: unit.id,
      canonicalName: unit.name,
      isContainer: unit.isContainer,
      aliasName: unitAlias.name,
    })
    .from(unitAlias)
    .innerJoin(unit, eq(unit.id, unitAlias.unitId))
    .all();
  for (const a of aliases) {
    const key = a.aliasName.toLowerCase();
    if (!byNameOrAlias.has(key)) {
      byNameOrAlias.set(key, {
        id: a.id,
        name: a.canonicalName,
        isContainer: a.isContainer,
      });
    }
    if (a.isContainer) containerTokens.add(key);
  }
  return { byNameOrAlias, byCanonicalName, containerTokens };
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
  // No unit token. Default to Stück for "3 Eier"-style entries.
  if (quantity !== null && quantity > 0) {
    const stueck = lookup.byCanonicalName.get("stück");
    if (stueck) {
      return { resolved: stueck, match: "defaulted", rawUnit: null };
    }
  }
  return { resolved: null, match: "empty", rawUnit: null };
}

export type IngredientLookupHit = {
  id: number;
  canonicalName: string;
  /** Per-alias default global unit. Used when the parser hits the alias with
   *  no explicit unit and no default sub-unit is configured. Rarely set. */
  defaultUnit?: { id: number; name: string };
  /** Per-alias default sub-unit (e.g. "Knoblauchzehe" → sub-unit "Zehe").
   *  Wins over `defaultUnit` when both are set on the same alias. */
  defaultSubUnit?: SubUnitRef;
};
export type IngredientLookup = Map<string, IngredientLookupHit>;

/**
 * Per-ingredient sub-units, keyed by ingredient id. The parser uses the
 * second-level map (name token → sub-unit ref) to resolve "Zehen Knoblauch"
 * once the ingredient is known.
 */
export type SubUnitLookup = Map<number, Map<string, SubUnitRef>>;

export function buildSubUnitLookup(): SubUnitLookup {
  const lookup: SubUnitLookup = new Map();
  const rows = db
    .select({
      id: ingredientSubUnit.id,
      ingredientId: ingredientSubUnit.ingredientId,
      name: ingredientSubUnit.name,
      perPurchase: ingredientSubUnit.perPurchase,
    })
    .from(ingredientSubUnit)
    .all();
  for (const r of rows) {
    const byName = lookup.get(r.ingredientId) ?? new Map<string, SubUnitRef>();
    const ref: SubUnitRef = {
      id: r.id,
      name: r.name,
      perPurchase: r.perPurchase,
    };
    byName.set(r.name.toLowerCase(), ref);
    // Catch the most common German plural ("Zehe" / "Zehen", "Zweig" /
    // "Zweige") without forcing a full alias table on sub-units.
    byName.set(`${r.name.toLowerCase()}n`, ref);
    if (r.name.endsWith("e")) {
      byName.set(`${r.name.toLowerCase()}n`, ref);
    } else {
      byName.set(`${r.name.toLowerCase()}e`, ref);
    }
    lookup.set(r.ingredientId, byName);
  }
  return lookup;
}

/**
 * Flat set of every sub-unit token across all ingredients. Used to extend
 * the parser's tokenisation alphabet so "Zehen" in "12 Zehen Knoblauch" is
 * pulled out as a unit token (it can't match a global unit anymore — Zehe
 * is no longer one — but the parser still needs to recognise it before
 * ingredient resolution can attach it to Knoblauch's sub-unit).
 */
export function subUnitTokenSet(lookup: SubUnitLookup): Set<string> {
  const out = new Set<string>();
  for (const byName of lookup.values()) {
    for (const key of byName.keys()) out.add(key);
  }
  return out;
}

/**
 * Walk every canonical ingredient + every alias row and emit one
 * {@link CatalogEntry} per *name we might match against*. Pre-tokenises each
 * name so the matcher doesn't have to re-do the work per row. Used by both
 * the parser (at recipe-import time) and the /match endpoint (for live
 * pill updates as the user types in the IngredientRow).
 */
export function buildIngredientCatalog(): IngredientCatalog {
  const out: IngredientCatalog = [];
  const canonicals = db
    .select({
      id: ingredient.id,
      name: ingredient.name,
      isEquipment: ingredient.isEquipment,
      defaultUnitId: ingredient.defaultUnitId,
      defaultUnitName: unit.name,
      defaultSubUnitId: ingredient.defaultSubUnitId,
      defaultSubUnitName: ingredientSubUnit.name,
      defaultSubUnitPerPurchase: ingredientSubUnit.perPurchase,
    })
    .from(ingredient)
    .leftJoin(unit, eq(unit.id, ingredient.defaultUnitId))
    .leftJoin(
      ingredientSubUnit,
      eq(ingredientSubUnit.id, ingredient.defaultSubUnitId),
    )
    .all();
  for (const i of canonicals) {
    out.push({
      ingredientId: i.id,
      canonicalName: i.name,
      aliasName: i.name,
      tokens: tokenizeEntryNameForCatalog(i.name),
      defaultUnit:
        i.defaultUnitId != null && i.defaultUnitName != null
          ? { id: i.defaultUnitId, name: i.defaultUnitName }
          : undefined,
      defaultSubUnit:
        i.defaultSubUnitId != null && i.defaultSubUnitName != null
          ? {
              id: i.defaultSubUnitId,
              name: i.defaultSubUnitName,
              perPurchase: i.defaultSubUnitPerPurchase ?? 1,
            }
          : undefined,
      isEquipment: i.isEquipment || undefined,
    });
  }
  const aliases = db
    .select({
      id: ingredient.id,
      canonicalName: ingredient.name,
      isEquipment: ingredient.isEquipment,
      aliasName: ingredientAlias.name,
      defaultUnitId: ingredientAlias.defaultUnitId,
      defaultUnitName: unit.name,
      defaultSubUnitId: ingredientAlias.defaultSubUnitId,
      defaultSubUnitName: ingredientSubUnit.name,
      defaultSubUnitPerPurchase: ingredientSubUnit.perPurchase,
    })
    .from(ingredientAlias)
    .innerJoin(ingredient, eq(ingredient.id, ingredientAlias.ingredientId))
    .leftJoin(unit, eq(unit.id, ingredientAlias.defaultUnitId))
    .leftJoin(
      ingredientSubUnit,
      eq(ingredientSubUnit.id, ingredientAlias.defaultSubUnitId),
    )
    .all();
  for (const a of aliases) {
    out.push({
      ingredientId: a.id,
      canonicalName: a.canonicalName,
      aliasName: a.aliasName,
      tokens: tokenizeEntryNameForCatalog(a.aliasName),
      defaultUnit:
        a.defaultUnitId != null && a.defaultUnitName != null
          ? { id: a.defaultUnitId, name: a.defaultUnitName }
          : undefined,
      defaultSubUnit:
        a.defaultSubUnitId != null && a.defaultSubUnitName != null
          ? {
              id: a.defaultSubUnitId,
              name: a.defaultSubUnitName,
              perPurchase: a.defaultSubUnitPerPurchase ?? 1,
            }
          : undefined,
      isEquipment: a.isEquipment || undefined,
    });
  }
  return out;
}

function tokenizeEntryNameForCatalog(name: string): string[] {
  // Mirror the candidate tokenizer so both sides see the same boundaries.
  const out: string[] = [];
  for (const piece of name.split(/[\s,;/\-–—]+/u)) {
    if (piece.length === 0) continue;
    const normalized = normalizeForMatch(piece);
    if (normalized.length === 0) continue;
    out.push(normalized);
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
      defaultSubUnitId: ingredient.defaultSubUnitId,
      defaultSubUnitName: ingredientSubUnit.name,
      defaultSubUnitPerPurchase: ingredientSubUnit.perPurchase,
    })
    .from(ingredient)
    .leftJoin(unit, eq(unit.id, ingredient.defaultUnitId))
    .leftJoin(
      ingredientSubUnit,
      eq(ingredientSubUnit.id, ingredient.defaultSubUnitId),
    )
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
          ? { id: i.defaultUnitId, name: i.defaultUnitName }
          : undefined,
      defaultSubUnit:
        i.defaultSubUnitId != null && i.defaultSubUnitName != null
          ? {
              id: i.defaultSubUnitId,
              name: i.defaultSubUnitName,
              perPurchase: i.defaultSubUnitPerPurchase ?? 1,
            }
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
      defaultSubUnitId: ingredientAlias.defaultSubUnitId,
      defaultSubUnitName: ingredientSubUnit.name,
      defaultSubUnitPerPurchase: ingredientSubUnit.perPurchase,
    })
    .from(ingredientAlias)
    .innerJoin(ingredient, eq(ingredient.id, ingredientAlias.ingredientId))
    .leftJoin(unit, eq(unit.id, ingredientAlias.defaultUnitId))
    .leftJoin(
      ingredientSubUnit,
      eq(ingredientSubUnit.id, ingredientAlias.defaultSubUnitId),
    )
    .all();
  for (const a of aliases) {
    const hit: IngredientLookupHit = {
      id: a.id,
      canonicalName: a.canonicalName,
      defaultUnit:
        a.defaultUnitId != null && a.defaultUnitName != null
          ? { id: a.defaultUnitId, name: a.defaultUnitName }
          : undefined,
      defaultSubUnit:
        a.defaultSubUnitId != null && a.defaultSubUnitName != null
          ? {
              id: a.defaultSubUnitId,
              name: a.defaultSubUnitName,
              perPurchase: a.defaultSubUnitPerPurchase ?? 1,
            }
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
  defaultSubUnit: SubUnitRef | null;
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
      defaultSubUnit: null,
    };
  const canonicalName =
    hit.canonicalName.toLowerCase() === key ? null : hit.canonicalName;
  return {
    id: hit.id,
    match: "existing",
    canonicalName,
    defaultUnit: hit.defaultUnit ?? null,
    defaultSubUnit: hit.defaultSubUnit ?? null,
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
  subUnits: SubUnitLookup;
};

/**
 * Run the substring matcher against the candidate text (parsed name +
 * comma-tail content joined as whitespace). When matches exist, the top one
 * becomes the row's resolved ingredient and any candidate-tokens it didn't
 * cover are folded back into notes. When nothing matches, fall back to the
 * conservatively-cleaned name (prep-strip / comma-tail extraction) so the
 * new-ingredient row gets a sensible name.
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
  candidateMatches: ImportedCandidateMatch[];
  newNameProposals: ImportedNameProposal[];
  /** Defaults attached to the resolved alias entry, if any. */
  defaultUnit: { id: number; name: string } | null;
  defaultSubUnit: SubUnitRef | null;
  /** True when the matched ingredient is flagged as equipment — the caller
   *  ORs this into the row's `isOptional` so equipment items default to
   *  optional on every recipe row. */
  isEquipment: boolean;
} {
  const catalog = lookups.ingredientCatalog;
  // Gather candidates for both the wide-text pass (returns ALL ranked
  // matches, including below-threshold ones) and the post-cleanup re-match.
  // The pill UI sees the wide-text list so it can surface low-score
  // alternatives the auto-pick rejected.
  let wideMatches: IngredientCandidateMatch[] = [];
  if (catalog && catalog.length > 0) {
    const wideText = [parsed.name, parsed.commaTailText]
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join(" ");
    if (wideText.length > 0) {
      const { matches, candidate } = findIngredientCandidates(wideText, catalog);
      wideMatches = matches;
      const top = matches[0];
      if (top && top.score >= autoMatchScoreThreshold) {
        // Preserve the user's text as the row's displayName rather than
        // replacing it with the catalog's canonical name. The shopping-list
        // aggregator keys off `ingredientId` so cross-language merging
        // ("tomatoes" + "Tomate") still happens, while the recipe stays in
        // its source language.
        //
        // Comma-tail tokens consumed by the match are IDENTITY, not
        // annotation ("Erbsen, TK" matched against "TK Erbsen" → the TK is
        // the user's identity, not a side note) — fold them into the
        // displayName and subtract them from notes. Unmatched comma-tail
        // tokens stay in notes.
        const folded = foldMatchedCommaTailIntoName(parsed, candidate, top);
        return {
          name: folded.name,
          notes: folded.notes,
          ingredientId: top.ingredientId,
          match: "existing",
          canonicalIngredientName:
            folded.name.toLowerCase() === top.canonicalName.toLowerCase()
              ? null
              : top.canonicalName,
          candidateMatches: matches.map(toImportedCandidateMatch),
          newNameProposals: [],
          defaultUnit: top.defaultUnit ?? null,
          defaultSubUnit: top.defaultSubUnit ?? null,
          isEquipment: top.isEquipment ?? false,
        };
      }
    }
  }

  // No (strong enough) wide-text hit — try the conservative cleanup and
  // (gated) re-match. The cleanup-rematch is what makes "frischer Zucker"
  // still resolve to "Zucker": prep-strip pulls "frischer" out, then the
  // matcher sees a bare "zucker" candidate which exact-matches above the
  // threshold. But we only re-match when we have evidence that the user
  // tagged the extra tokens as "notes":
  //   - altWithPrepStripped is non-null (real prep was stripped from the
  //     name area), OR
  //   - the comma-tail content is ALL prep-like (PREP_LEADING_TOKENS or
  //     SIZE_MODIFIER_TOKENS — words like "klein", "gehackt", "fein").
  // For "Paprikapulver, edelsüß" the comma-tail "edelsüß" is neither prep
  // nor size, so we treat it as part of the user's intended identity and
  // skip the re-match. Same outcome as the no-comma form: a new
  // "Paprikapulver edelsüß" ingredient gets created.
  const cleaned = pickNameAndNotes(
    rawLine,
    parsed,
    lookups.ingredients,
    lookups.units.containerTokens,
  );
  const commaTailIsAllPrepLike =
    parsed.commaTailText.trim().length > 0 &&
    isAllPrepLikeText(parsed.commaTailText);
  const rematchAllowed =
    parsed.altWithPrepStripped !== null || commaTailIsAllPrepLike;
  if (
    rematchAllowed &&
    catalog &&
    catalog.length > 0 &&
    cleaned.name.trim().length > 0
  ) {
    const { matches: rematchMatches } = findIngredientCandidates(
      cleaned.name,
      catalog,
    );
    const top = rematchMatches[0];
    if (top && top.score >= autoMatchScoreThreshold) {
      // Use the prep-stripped form as displayName so the row reads cleanly
      // ("frischer Zucker" → name "Zucker", note "frischer") while still
      // preserving the user's original input minus the stripped prep.
      // Canonical name surfaces via `canonicalIngredientName` when it
      // differs from the cleaned text.
      return {
        name: cleaned.name,
        notes: cleaned.notes,
        ingredientId: top.ingredientId,
        match: "existing",
        canonicalIngredientName:
          cleaned.name.toLowerCase() === top.canonicalName.toLowerCase()
            ? null
            : top.canonicalName,
        // Surface BOTH the wide-text matches (so low-score alternatives
        // still appear in the pill UI) and the re-match results.
        candidateMatches: mergeCandidateLists(
          rematchMatches.map(toImportedCandidateMatch),
          wideMatches.map(toImportedCandidateMatch),
        ),
        newNameProposals: [],
        defaultUnit: top.defaultUnit ?? null,
        defaultSubUnit: top.defaultSubUnit ?? null,
        isEquipment: top.isEquipment ?? false,
      };
    }
  }

  // Still nothing above threshold — create a new ingredient. When the
  // comma-tail content is part of the user's identity (not all prep-like),
  // fold it back into the new ingredient's NAME so "Paprikapulver,
  // edelsüß" and "Paprikapulver edelsüß" both create the same ingredient
  // "Paprikapulver edelsüß". Otherwise the comma-tail stays as notes
  // (existing behaviour for "Tomaten, klein gehackt"-style rows).
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
    candidateMatches: wideMatches.map(toImportedCandidateMatch),
    newNameProposals: proposals,
    defaultUnit: null,
    defaultSubUnit: null,
    isEquipment: false,
  };
}

function toImportedCandidateMatch(
  m: IngredientCandidateMatch,
): ImportedCandidateMatch {
  return {
    ingredientId: m.ingredientId,
    canonicalName: m.canonicalName,
    matchedName: m.aliasName,
    score: m.score,
    uncoveredText: m.uncoveredText,
    isEquipment: m.isEquipment ?? false,
  };
}

/**
 * True when every token in `text` is a prep-like word (PREP_LEADING_TOKENS
 * or SIZE_MODIFIER_TOKENS — "klein", "gehackt", "fein", …). The
 * cleanup-rematch path uses this to decide whether the comma-tail content
 * is a user-marked note ("Tomaten, klein gehackt") or part of the
 * identity ("Paprikapulver, edelsüß").
 */
function isAllPrepLikeText(text: string): boolean {
  const tokens = text
    .split(/[\s,;]+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return false;
  return tokens.every((t) => isPrepLeadingToken(t.replace(/[.,;]$/, "")));
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
 * Remove the comma-tail substring from a notes string once. Used when the
 * comma-tail content gets folded back into the new-ingredient name, so
 * the same content doesn't also appear as a note. Best-effort verbatim
 * match — when the comma-tail isn't present in the notes string (rare),
 * the notes are left untouched.
 */
function subtractCommaTail(
  notes: string | null,
  commaTailText: string,
): string | null {
  return replaceCommaTailContent(notes, commaTailText, "");
}

/**
 * Rewrite the comma-tail run inside a notes string. Used when the matcher
 * consumed PART of the comma-tail (folded those tokens into displayName)
 * but other comma-tail tokens are unmatched and should stay in notes.
 * Passing an empty `replacement` removes the run entirely (same effect as
 * the legacy {@link subtractCommaTail} call).
 */
function replaceCommaTailContent(
  notes: string | null,
  oldCommaTailText: string,
  replacement: string,
): string | null {
  if (!notes) return null;
  const trimmed = oldCommaTailText.trim();
  if (trimmed.length === 0) return notes;
  const re = new RegExp(
    `(^|,\\s*)${trimmed.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(?=,\\s*|$)`,
    "i",
  );
  const repl = replacement.trim();
  const replaced = notes.replace(re, (_, prefix) =>
    repl.length > 0 ? `${prefix}${repl}` : "",
  );
  const cleaned = replaced.replace(/^,\s*|,\s*$/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * When the matcher consumed tokens from the comma-tail (`parsed.commaTailText`),
 * fold those tokens into the displayName — the comma-tail content was
 * identity (e.g. "Erbsen, TK" hitting catalog row "TK Erbsen"), not a side
 * note. Tokens NOT consumed stay in notes.
 *
 * Behaviour:
 *   - No comma-tail OR no comma-tail tokens consumed → return parsed
 *     name/notes unchanged (existing behaviour).
 *   - All comma-tail tokens consumed → keep the user's original comma form
 *     ("Erbsen, TK") as displayName so the row reads exactly like the
 *     source line; strip the comma-tail substring from notes.
 *   - Some but not all consumed → space-join the consumed tokens onto the
 *     name (no comma — there's still a leftover note); rewrite the notes
 *     so only the unmatched comma-tail content remains.
 */
function foldMatchedCommaTailIntoName(
  parsed: ParsedIngredient,
  candidate: ReturnType<typeof tokenizeCandidate>,
  top: IngredientCandidateMatch,
): { name: string; notes: string | null } {
  const commaTail = parsed.commaTailText.trim();
  if (commaTail.length === 0) {
    return { name: parsed.name, notes: parsed.notes };
  }
  // `wideText` was built as `parsed.name + " " + parsed.commaTailText`, so
  // candidate token indices ≥ nameTokenCount belong to the comma-tail.
  const nameTokenCount = tokenizeCandidate(parsed.name).length;
  const totalCommaTailCount = candidate.length - nameTokenCount;
  if (totalCommaTailCount <= 0) {
    return { name: parsed.name, notes: parsed.notes };
  }
  const matchedCommaTailIndices = top.coveredCandidateTokens
    .filter((i) => i >= nameTokenCount)
    .sort((a, b) => a - b);
  if (matchedCommaTailIndices.length === 0) {
    return { name: parsed.name, notes: parsed.notes };
  }
  if (matchedCommaTailIndices.length === totalCommaTailCount) {
    return {
      name: `${parsed.name}, ${parsed.commaTailText}`,
      notes: subtractCommaTail(parsed.notes, parsed.commaTailText),
    };
  }
  const matchedSet = new Set(matchedCommaTailIndices);
  const consumedRaw = matchedCommaTailIndices
    .map((i) => candidate[i].raw)
    .join(" ");
  const leftoverRaw = candidate
    .slice(nameTokenCount)
    .filter((_, i) => !matchedSet.has(i + nameTokenCount))
    .map((t) => t.raw)
    .join(" ");
  return {
    name: `${parsed.name} ${consumedRaw}`,
    notes: replaceCommaTailContent(
      parsed.notes,
      parsed.commaTailText,
      leftoverRaw,
    ),
  };
}

function mergeCandidateLists(
  primary: ImportedCandidateMatch[],
  fallback: ImportedCandidateMatch[],
): ImportedCandidateMatch[] {
  const seen = new Set<number>();
  const out: ImportedCandidateMatch[] = [];
  for (const m of [...primary, ...fallback]) {
    if (seen.has(m.ingredientId)) continue;
    seen.add(m.ingredientId);
    out.push(m);
  }
  return out;
}

/**
 * Decide between an initial global-unit resolution and an ingredient-scoped
 * sub-unit, based on whatever context the parser pulled together. Order of
 * precedence:
 *   1. The unit token resolved to a real global unit ("g", "EL")            → unit
 *   2. A unit token existed and matches one of the resolved ingredient's
 *      sub-units                                                            → sub-unit
 *   3. No unit token, but the ingredient was matched via an alias that
 *      defines a default sub-unit ("Knoblauchzehe")                         → sub-unit
 *   4. Initial global-unit fallback (Stück for "3 Eier")                    → unit
 */
function pickFinalUnit(
  initial: ResolveUnitResult,
  rawUnitToken: string | null,
  ingredientId: number | null,
  subUnits: SubUnitLookup,
  aliasDefaultSubUnit: SubUnitRef | null,
  aliasDefaultUnit: { id: number; name: string } | null,
): {
  resolved: { id: number; name: string } | null;
  subUnit: SubUnitRef | null;
  match: UnitMatch;
  rawUnit: string | null;
} {
  if (initial.match === "matched") {
    return {
      resolved: initial.resolved,
      subUnit: null,
      match: initial.match,
      rawUnit: initial.rawUnit,
    };
  }
  if (
    (initial.match === "unresolved" || initial.match === "defaulted") &&
    rawUnitToken &&
    ingredientId != null
  ) {
    const byName = subUnits.get(ingredientId);
    const sub = byName?.get(rawUnitToken.toLowerCase());
    if (sub) {
      return {
        resolved: null,
        subUnit: sub,
        match: "matched",
        rawUnit: null,
      };
    }
  }
  if (initial.match === "defaulted" || initial.match === "empty") {
    // Alias defaults supply a *resolved* unit — we shouldn't surface the
    // "Standard: Stück" badge on top of it. Treat the alias hit as a clean
    // match so the import-review UI shows the picked unit / sub-unit as the
    // actual selection.
    if (aliasDefaultSubUnit) {
      return {
        resolved: null,
        subUnit: aliasDefaultSubUnit,
        match: "matched",
        rawUnit: null,
      };
    }
    if (aliasDefaultUnit) {
      return {
        resolved: aliasDefaultUnit,
        subUnit: null,
        match: "matched",
        rawUnit: null,
      };
    }
  }
  return {
    resolved: initial.resolved,
    subUnit: null,
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
    ...subUnitTokenSet(lookups.subUnits),
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
        const final = pickFinalUnit(
          initialUnit,
          parsed.unitName,
          resolved.ingredientId,
          lookups.subUnits,
          resolved.defaultSubUnit,
          resolved.defaultUnit,
        );
        out.push({
          quantity: parsed.quantity,
          unit: final.resolved,
          subUnit: final.subUnit,
          unitMatch: final.match,
          rawUnit: final.rawUnit,
          name: resolved.name,
          ingredientId: resolved.ingredientId,
          ingredientMatch: resolved.match,
          canonicalIngredientName: resolved.canonicalIngredientName,
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
    ...subUnitTokenSet(lookups.subUnits),
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
        const final = pickFinalUnit(
          initialUnit,
          parsed.unitName,
          resolved.ingredientId,
          lookups.subUnits,
          resolved.defaultSubUnit,
          resolved.defaultUnit,
        );
        currentGroup.ingredients.push({
          quantity: parsed.quantity,
          unit: final.resolved,
          subUnit: final.subUnit,
          unitMatch: final.match,
          rawUnit: final.rawUnit,
          name: resolved.name,
          ingredientId: resolved.ingredientId,
          ingredientMatch: resolved.match,
          canonicalIngredientName: resolved.canonicalIngredientName,
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
  const subUnitLookup = buildSubUnitLookup();

  // Section-aware: ingredients and instructions both get split on shared
  // section headers ("Für den Teig:", "FÜR DIE FÜLLUNG"). Matching titles
  // land in the same merged section. Unmatched leftovers either prepend
  // to the first section (unnamed lead-in) or become their own ingredient-
  // less sections (named).
  const ingredientGroups = parseIngredientLinesIntoSections(ingredientStrings, {
    units: unitLookup,
    ingredients: ingredientLookup,
    ingredientCatalog,
    subUnits: subUnitLookup,
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
