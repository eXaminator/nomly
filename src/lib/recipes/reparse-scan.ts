import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredient,
  quantifier,
  recipe,
  recipeIngredient,
  recipeSection,
  unit,
  unitAlias,
} from "@/db/schema";
import {
  buildIngredientCatalog,
  buildIngredientLookup,
  buildQuantifierLookup,
  buildUnitLookup,
  parseIngredientLines,
} from "@/lib/recipe-import";
import {
  buildCatalogBlockIndex,
  type CatalogBlockIndex,
} from "@/lib/recipe-import/matching";
import { loadMuteSet } from "@/lib/recipes/reparse-mutes";
import type { ParsedIngredientResponse } from "@/components/recipes/types";
import type {
  RecipeIngredientInput,
  RecipeInput,
  RecipeView,
} from "@/lib/recipes/types";

/**
 * Bulk re-parse: scan every recipe's ingredient source lines with the current
 * parser, surface only the line-groups whose output differs from what's
 * stored, and (on apply) rebuild affected recipes through the normal update
 * path. See docs/superpowers/specs/2026-05-30-bulk-reparse-recipes-design.md.
 */

/** The parse inputs built once per scan. */
type ReparseLookups = {
  units: ReturnType<typeof buildUnitLookup>;
  ingredients: ReturnType<typeof buildIngredientLookup>;
  ingredientCatalog: ReturnType<typeof buildIngredientCatalog>;
  ingredientCatalogIndex: CatalogBlockIndex;
  quantifiers: ReturnType<typeof buildQuantifierLookup>;
};

/** Current (stored) ingredient row, reduced to the fields that decide whether
 *  a re-parse would change anything. */
export type CurrentRow = {
  id: number;
  ingredientId: number | null;
  name: string;
  quantity: number | null;
  quantityLow: number | null;
  /** Quantifier reference stored on this row, else null. Included so a pure
   *  literal-number → quantifier-reference change (same effective number)
   *  surfaces in the diff rather than being silently ignored. */
  quantifierId: number | null;
  unitId: number | null;
  notes: string | null;
  isOptional: boolean;
  alternativeForId: number | null;
};

const QTY_EPSILON = 1e-4;

function normNotes(n: string | null | undefined): string {
  return (n ?? "").trim();
}

/** Normalize a member name/label for identity matching against parser
 *  potentials (mirrors the editor's slot reconciliation). */
function nameKey(s: string): string {
  return s.trim().toLowerCase().replace(/[.,:;]+$/g, "");
}

function qtyEqual(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < QTY_EPSILON;
}

/** Comparison key for a current row — every field except quantity (compared
 *  separately with an epsilon). */
function currentKey(r: CurrentRow): string {
  return JSON.stringify([
    r.ingredientId ?? null,
    r.name.trim(),
    normNotes(r.notes),
    r.unitId ?? null,
    r.isOptional,
    r.alternativeForId != null,
  ]);
}

/** Comparison key for a freshly-parsed row, aligned field-for-field with
 *  {@link currentKey}. */
function proposedKey(p: ParsedIngredientResponse): string {
  return JSON.stringify([
    p.ingredientId ?? null,
    p.name.trim(),
    normNotes(p.notes),
    p.unit?.id ?? null,
    p.isOptional ?? false,
    p.isAlternative ?? false,
  ]);
}

/**
 * True when the freshly parsed rows differ from the current rows on any
 * meaningful field — ingredient mapping, display name, notes, quantity,
 * quantifier reference, unit, optional flag, alternative flag — or in row
 * count. A pure literal-number → quantifier-reference change (same effective
 * number, same ingredient, same unit) is a change because the two amount
 * forms are not equivalent at the persistence level.
 */
export function isLineGroupChanged(
  current: CurrentRow[],
  proposed: ParsedIngredientResponse[],
): boolean {
  if (current.length !== proposed.length) return true;
  for (let i = 0; i < current.length; i++) {
    if (currentKey(current[i]) !== proposedKey(proposed[i])) return true;
    if (!qtyEqual(current[i].quantity, proposed[i].quantity)) return true;
    // A range that changed only its low bound is still a change.
    if (!qtyEqual(current[i].quantityLow, proposed[i].quantityLow)) return true;
    // A pure literal→quantifier change (or vice versa) at the same effective
    // number is still a meaningful change — the two representations are not
    // equivalent at the persistence level (quantifierId vs a numeric quantity).
    if ((current[i].quantifierId ?? null) !== (proposed[i].quantifierId ?? null)) return true;
  }
  return false;
}

/**
 * Split rows (already ordered by recipe → section → sortOrder) into the
 * contiguous runs that share a non-empty `rawLine` within the same section.
 * A run breaks on a section change or a different `rawLine`.
 *
 * A row with an empty `rawLine` that is an alternative (`alternativeForId`
 * pointing into the run directly above it) is a manually-added alternative —
 * it carries no source line because the user created it in the editor, not by
 * parsing text. It's absorbed into its primary's group so the reparse dialog
 * can show and preserve it. Any other empty-`rawLine` row (no alternative
 * linkage) is dropped — there's nothing to re-parse.
 */
export function groupContiguousByRawLine<
  T extends {
    sectionId: number;
    rawLine: string | null;
    id?: number;
    alternativeForId?: number | null;
  },
>(rows: readonly T[]): T[][] {
  const groups: T[][] = [];
  let i = 0;
  while (i < rows.length) {
    const raw = (rows[i].rawLine ?? "").trim();
    if (raw.length === 0) {
      // Manually-added alternative: attach to the group of the primary it
      // links to (which sits immediately above it in sort order).
      const last = groups[groups.length - 1];
      const altFor = rows[i].alternativeForId;
      if (
        last &&
        altFor != null &&
        last[0].sectionId === rows[i].sectionId &&
        last.some((r) => r.id === altFor)
      ) {
        last.push(rows[i]);
      }
      i += 1;
      continue;
    }
    const group: T[] = [];
    const sectionId = rows[i].sectionId;
    while (
      i < rows.length &&
      rows[i].sectionId === sectionId &&
      (rows[i].rawLine ?? "").trim() === raw
    ) {
      group.push(rows[i]);
      i += 1;
    }
    groups.push(group);
  }
  return groups;
}

/** Compact read-only summary of a current row for the review UI. */
export type ScanRowSummary = {
  /** Catalog ingredient id this row resolves to (null = unassigned). The diff
   *  compares this against the proposed row's id to decide whether the mapping
   *  actually changed — a label that only differs in casing/alias is NOT a
   *  change. */
  ingredientId: number | null;
  name: string;
  canonicalName: string | null;
  quantity: number | null;
  /** Low bound of an amount range, else null → diff renders "low–high". */
  quantityLow: number | null;
  unitLabel: string | null;
  /** Whether this row's unit is flagged for fraction display. */
  displayFraction: boolean;
  /** The configured quantifier this row's amount references, else null. The
   *  diff compares this (alongside quantity/unit) so a literal amount vs a
   *  quantifier with the same effective number reads as a CHANGE. */
  quantifierId: number | null;
  /** Canonical name of the referenced quantifier ("zwei"), else null — drives
   *  the diff's quantifier hover tooltip. */
  quantifierName: string | null;
  /** Numeric value of the referenced quantifier (null for an unspecified one
   *  like "einige"), else null — the effective amount the diff renders. */
  quantifierValue: number | null;
  /** Always null for current (DB) rows — source text is not stored. */
  quantifierSource: string | null;
  notes: string | null;
  isOptional: boolean;
  isAlternative: boolean;
};

/** One changed source-line group within a recipe. */
export type ReparseScanEntry = {
  recipeId: number;
  title: string;
  sectionId: number;
  rawLine: string;
  /** recipe_ingredient ids of the current group — the apply target. */
  currentRowIds: number[];
  current: ScanRowSummary[];
  proposed: ParsedIngredientResponse[];
};

/**
 * Build the `proposed` representation of a manually-added alternative. It has
 * no source line to re-parse, so it's mirrored straight from its stored row
 * and carried through the diff/apply unchanged. `rawText` stays undefined so
 * it re-persists as a manual alternative (empty rawLine) on the next scan,
 * making the round-trip stable.
 */
function carriedAlternativeToProposed(g: {
  ingredientId: number | null;
  name: string | null;
  canonicalName: string | null;
  quantity: number | null;
  quantityLow: number | null;
  unitId: number | null;
  unitName: string | null;
  displayUnit: string | null;
  notes: string | null;
}): ParsedIngredientResponse {
  return {
    quantity: g.quantity,
    quantityLow: g.quantityLow,
    quantifierId: null,
    quantifierName: null,
    quantifierSource: null,
    unit:
      g.unitId != null
        ? { id: g.unitId, name: g.displayUnit ?? g.unitName ?? "" }
        : null,
    unitMatch: "matched",
    rawUnit: null,
    name: g.name ?? "",
    ingredientId: g.ingredientId,
    ingredientMatch: g.ingredientId != null ? "existing" : "new",
    canonicalIngredientName: g.canonicalName ?? null,
    notes: g.notes,
    isOptional: true,
    isAlternative: true,
    fixedAmount: g.quantity == null,
    // Flag so the diff shows it as "would be removed" with a keep toggle — the
    // re-parse doesn't reproduce it, so by default applying drops it.
    carried: true,
  };
}

/**
 * Existing alternatives in a scanned group that the re-parse does NOT
 * reproduce, so they must be carried through unchanged — otherwise applying a
 * change to the ingredient silently trims its alternative unit. Two sources:
 *
 *  - **Manual** alternatives (empty rawLine): never produced by parsing. Kept
 *    unless the parser now produces the same ingredient on its own (avoids a
 *    duplicate / phantom diff once the parser catches up to a hand-add).
 *  - **Surplus source-line** alternatives: the parser's output replaces the
 *    source-line rows (primary + in-source alternatives) positionally. When
 *    re-parsing yields FEWER rows than the group's source-line rows, the
 *    trailing alternatives have no counterpart and would be deleted on apply,
 *    so they're carried. Source-line alternatives the parser DOES still
 *    produce are left to it — that's how a re-map of an alternative applies.
 *
 * `group` is sort-order-ordered (primary first); `proposedCount` is the number
 * of rows the re-parse produced for the line.
 */
export function carriedAlternatives<
  T extends {
    rawLine: string | null;
    alternativeForId?: number | null;
    ingredientId: number | null;
  },
>(
  group: readonly T[],
  proposedCount: number,
  derivedIngredientIds: ReadonlySet<number>,
): T[] {
  const sourceRows = group.filter((g) => (g.rawLine ?? "").trim().length > 0);
  const manualRows = group.filter((g) => (g.rawLine ?? "").trim().length === 0);
  const droppedSource = sourceRows
    .slice(proposedCount)
    .filter((g) => g.alternativeForId != null);
  const carriedManual = manualRows.filter(
    (g) =>
      g.alternativeForId != null &&
      (g.ingredientId == null || !derivedIngredientIds.has(g.ingredientId)),
  );
  return [...droppedSource, ...carriedManual];
}

/** Yield to the event loop between chunks of a large scan. A *macrotask* hop
 *  (setImmediate) — not a microtask like `await Promise.resolve()` — is what
 *  actually lets other queued HTTP requests (navigations, API calls) run while
 *  the scan is in progress. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** How many line-groups to parse between event-loop yields. Big enough that the
 *  per-chunk yield overhead stays negligible, small enough that the longest
 *  uninterrupted block is a handful of parses. */
const SCAN_YIELD_EVERY = 25;

/**
 * In-memory cache of the PROPOSED parse keyed by trimmed raw line. The proposed
 * parse is a pure function of `(rawLine, lookups)`, so a raw line shared across
 * recipes parses once (within-scan dedup) and a reopen with an unchanged
 * catalog reuses everything (cross-open reuse — the dialog is opened
 * repeatedly). Only the proposed side is cached; the "changed?" decision still
 * reads the current rows fresh each scan. Process-lifetime only — a restart
 * starts cold, which is fine.
 */
const parseCache = new Map<string, ParsedIngredientResponse[]>();
/** Fingerprint of the parse inputs the cache was built against. When the
 *  catalog or unit lookup changes, the fingerprint changes and the cache is
 *  dropped — so an ingredient/alias/unit/global-default edit between two opens
 *  is reflected. */
let cacheFingerprint: string | null = null;
/** Counts actual parser invocations (cache misses) — test-only observability. */
let parseInvocations = 0;
/** Block index for the cached catalog — rebuilt alongside the cache when the
 *  fingerprint changes, so the cold reparse only scores ~70 candidates/line
 *  instead of all ~3,000 catalog entries. */
let catalogIndex: CatalogBlockIndex | null = null;

/** FNV-1a over the parse inputs: catalog entries (id|aliasName|unitId) plus the
 *  unit lookup (token→id, sorted) and the global default unit. Cheap over a few
 *  thousand entries; no large string allocation. */
function fingerprintInputs(
  catalog: ReparseLookups["ingredientCatalog"],
  units: ReparseLookups["units"],
): string {
  let h = 0x811c9dc5;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const e of catalog) {
    mix(e.aliasName);
    mix("|");
    mix(String(e.ingredientId));
    mix("|");
    mix(String(e.unitId ?? ""));
    mix(";");
  }
  const unitKeys = Array.from(units.byNameOrAlias.entries())
    .map(([k, v]) => `${k}=${v.id}`)
    .sort();
  for (const k of unitKeys) {
    mix(k);
    mix(",");
  }
  mix(`gd=${units.globalDefaultUnitId ?? ""}`);
  return (h >>> 0).toString(16);
}

/** Parse a single raw line through the cache, counting genuine misses. */
function parseLineCached(
  rawLine: string,
  lookups: ReparseLookups,
): ParsedIngredientResponse[] {
  const hit = parseCache.get(rawLine);
  if (hit) return hit;
  parseInvocations += 1;
  const parsed = parseIngredientLines(
    [rawLine],
    lookups,
  ) as unknown as ParsedIngredientResponse[];
  parseCache.set(rawLine, parsed);
  return parsed;
}

/** Test-only: clear the parse cache + fingerprint + invocation counter. */
export function __resetReparseParseCache(): void {
  parseCache.clear();
  cacheFingerprint = null;
  catalogIndex = null;
  parseInvocations = 0;
}

/** Test-only: number of genuine parser invocations since the last reset. */
export function __getReparseParseInvocations(): number {
  return parseInvocations;
}

/**
 * Scan every recipe. For each contiguous source-line group, re-parse the line
 * with the current parser and keep only groups whose output differs from the
 * stored rows. One DB read for all ingredient rows; parsing is in-process.
 *
 * Async + chunked: the parse loop yields to the event loop every
 * {@link SCAN_YIELD_EVERY} groups so it doesn't freeze the single-threaded
 * server, and honors `signal` (the request aborts when the dialog is closed or
 * the user navigates away) by bailing at the next chunk boundary.
 */
export async function scanAllRecipesForReparse(
  signal?: AbortSignal,
): Promise<ReparseScanEntry[]> {
  const units = buildUnitLookup();
  const ingredients = buildIngredientLookup();
  const ingredientCatalog = buildIngredientCatalog();
  // Drop the parse cache + rebuild the block index when the parse inputs changed
  // since the last scan. An unchanged catalog keeps both warm so reopening the
  // dialog is near-instant; after a catalog edit the cold rescan still only
  // scores the indexed candidate subset (~70/line vs ~3,000).
  const fingerprint = fingerprintInputs(ingredientCatalog, units);
  if (fingerprint !== cacheFingerprint || catalogIndex === null) {
    parseCache.clear();
    catalogIndex = buildCatalogBlockIndex(ingredientCatalog);
    cacheFingerprint = fingerprint;
  }
  const lookups: ReparseLookups = {
    units,
    ingredients,
    ingredientCatalog,
    ingredientCatalogIndex: catalogIndex,
    quantifiers: buildQuantifierLookup(),
  };
  // Muted recipes / lines are skipped entirely (not parsed, not returned) —
  // diffs the user has intentionally hand-handled.
  const muted = loadMuteSet();
  const rows = db
    .select({
      recipeId: recipe.id,
      title: recipe.title,
      sectionId: recipeSection.id,
      sectionSort: recipeSection.sortOrder,
      id: recipeIngredient.id,
      sortOrder: recipeIngredient.sortOrder,
      ingredientId: recipeIngredient.ingredientId,
      name: recipeIngredient.displayName,
      canonicalName: ingredient.name,
      quantity: recipeIngredient.quantity,
      quantityLow: recipeIngredient.quantityLow,
      quantifierId: recipeIngredient.quantifierId,
      quantifierName: quantifier.name,
      quantifierValue: quantifier.value,
      displayQuantifier: recipeIngredient.displayQuantifier,
      unitId: recipeIngredient.unitId,
      unitName: unit.name,
      displayFraction: unit.displayFraction,
      displayUnit: recipeIngredient.displayUnit,
      notes: recipeIngredient.notes,
      isOptional: recipeIngredient.isOptional,
      alternativeForId: recipeIngredient.alternativeForId,
      rawLine: recipeIngredient.rawLine,
    })
    .from(recipeIngredient)
    .innerJoin(recipeSection, eq(recipeSection.id, recipeIngredient.sectionId))
    .innerJoin(recipe, eq(recipe.id, recipeSection.recipeId))
    .leftJoin(ingredient, eq(ingredient.id, recipeIngredient.ingredientId))
    .leftJoin(unit, eq(unit.id, recipeIngredient.unitId))
    // LEFT join: most rows reference no quantifier (literal-amount rows).
    .leftJoin(quantifier, eq(quantifier.id, recipeIngredient.quantifierId))
    .orderBy(
      asc(recipe.id),
      asc(recipeSection.sortOrder),
      asc(recipeSection.id),
      asc(recipeIngredient.sortOrder),
    )
    .all();
  signal?.throwIfAborted();

  const groups = groupContiguousByRawLine(rows);
  const entries: ReparseScanEntry[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    // Hand the event loop back periodically so navigations/API calls aren't
    // starved, and stop early if the client disconnected (dialog closed).
    if (gi > 0 && gi % SCAN_YIELD_EVERY === 0) {
      signal?.throwIfAborted();
      await yieldToEventLoop();
    }
    const group = groups[gi];
    const head = group[0];
    const rawLine = (head.rawLine ?? "").trim();
    // Skip muted groups before any parsing (hide + cost nothing).
    if (muted.recipes.has(head.recipeId) || muted.lines.has(`${head.recipeId} ${rawLine}`)) {
      continue;
    }
    const current: CurrentRow[] = group.map((g) => ({
      id: g.id,
      ingredientId: g.ingredientId,
      name: g.name ?? "",
      quantity: g.quantity,
      quantityLow: g.quantityLow,
      quantifierId: g.quantifierId ?? null,
      unitId: g.unitId,
      notes: g.notes,
      isOptional: g.isOptional,
      alternativeForId: g.alternativeForId,
    }));
    let proposedDerived = parseLineCached(rawLine, lookups);
    // A line that now reads as noise (no rows) shouldn't propose deleting a
    // real ingredient — skip it (mirrors the per-row re-parse guard).
    if (proposedDerived.length === 0) continue;
    // Alternatives the re-parse doesn't reproduce (manual ones, or in-source
    // ones the parser no longer extracts) are carried through unchanged on
    // BOTH sides, so the whole alternative unit survives a reparse instead of
    // being silently trimmed on apply. See {@link carriedAlternatives}.
    let derivedIds = new Set(
      proposedDerived
        .map((p) => p.ingredientId)
        .filter((id): id is number => id != null),
    );
    let carriedRows = carriedAlternatives(group, proposedDerived.length, derivedIds);
    // Reconcile by identity (spec Layer 3): a carried row that matches one of
    // the parse's "potential" members (a folded alternative / coordinated-list
    // ingredient, by name) is NOT a removal — the user already has it as a row.
    // Re-emit those potentials so `proposed` includes them, and only the rows
    // matching NO potential stay carried (genuine manual additions). Without
    // this, a saved pill-added member ("Schmackofatz") shows as "would remove".
    const potentials = proposedDerived.flatMap((p) =>
      [...(p.foldedAlternatives ?? []), ...(p.foldedIngredients ?? [])],
    );
    if (potentials.length > 0 && carriedRows.length > 0) {
      const carriedKeys = new Set(carriedRows.map((r) => nameKey(r.name ?? "")));
      const reemit = potentials.filter((pot) => carriedKeys.has(nameKey(pot.label)));
      if (reemit.length > 0) {
        const reemitKeys = new Set(reemit.map((pot) => nameKey(pot.label)));
        proposedDerived = parseIngredientLines([rawLine], lookups, {
          forceEmitRanges: reemit.map((pot) => pot.range),
        }) as unknown as ParsedIngredientResponse[];
        derivedIds = new Set(
          proposedDerived.map((p) => p.ingredientId).filter((id): id is number => id != null),
        );
        // Drop the rescued rows from the carried set (they're now real rows).
        carriedRows = carriedAlternatives(group, proposedDerived.length, derivedIds).filter(
          (r) => !reemitKeys.has(nameKey(r.name ?? "")),
        );
      }
    }
    const carried = carriedRows.map(carriedAlternativeToProposed);
    const proposed = [...proposedDerived, ...carried];
    // A carried alternative defaults to removal on apply, so its mere presence
    // is a proposed change — surface the group even when the derived rows
    // match the current ones.
    if (carried.length === 0 && !isLineGroupChanged(current, proposed)) continue;
    entries.push({
      recipeId: head.recipeId,
      title: head.title,
      sectionId: head.sectionId,
      rawLine,
      currentRowIds: group.map((g) => g.id),
      current: group.map((g) => ({
        ingredientId: g.ingredientId,
        name: g.name ?? "",
        canonicalName: g.canonicalName ?? null,
        // Unassigned lines are pure text — mask any stale amount/unit left
        // over from before the unlink, matching the recipe read view.
        quantity: g.ingredientId == null ? null : g.quantity,
        quantityLow: g.ingredientId == null ? null : g.quantityLow,
        quantifierId: g.ingredientId == null ? null : g.quantifierId,
        quantifierName: g.ingredientId == null ? null : (g.quantifierName ?? null),
        quantifierValue: g.ingredientId == null ? null : (g.quantifierValue ?? null),
        // The matched source word ("a"), now persisted as display_quantifier.
        quantifierSource: g.ingredientId == null ? null : (g.displayQuantifier ?? null),
        // Match the recipe read view: display_unit, then the canonical unit name.
        unitLabel:
          g.ingredientId == null ? null : (g.displayUnit ?? g.unitName ?? null),
        displayFraction: g.displayFraction ?? false,
        notes: g.notes,
        isOptional: g.isOptional,
        isAlternative: g.alternativeForId != null,
      })),
      proposed,
    });
  }
  return entries;
}

/** A unit's display forms — its canonical singular/plural plus each alias's,
 *  shipped to the bulk-reparse dialog so it can inflect a label by quantity
 *  (and thereby ignore singular/plural differences in the diff). */
export type UnitForm = {
  id: number;
  name: string;
  plural: string | null;
  /** Whether this unit is flagged for fraction display — lets the diff render
   *  proposed rows (which carry only a unit id) as fractions too. */
  displayFraction: boolean;
  aliases: { name: string; plural: string | null }[];
};

/** Load every unit's singular/plural forms (canonical + aliases) for the
 *  client-side inflector. The unit/alias tables are small, so load them whole. */
export function loadUnitForms(): UnitForm[] {
  const units = db
    .select({
      id: unit.id,
      name: unit.name,
      plural: unit.plural,
      displayFraction: unit.displayFraction,
    })
    .from(unit)
    .all();
  const aliases = db
    .select({ unitId: unitAlias.unitId, name: unitAlias.name, plural: unitAlias.plural })
    .from(unitAlias)
    .all();
  const byId = new Map<number, UnitForm>(
    units.map((u) => [
      u.id,
      {
        id: u.id,
        name: u.name,
        plural: u.plural,
        displayFraction: u.displayFraction,
        aliases: [],
      },
    ]),
  );
  for (const a of aliases) {
    byId.get(a.unitId)?.aliases.push({ name: a.name, plural: a.plural });
  }
  return [...byId.values()];
}

/** One line-group replacement: the current rows to drop (by id) and the new
 *  rows to insert in their place. */
export type ReparseReplacement = {
  replaceRowIds: number[];
  rows: RecipeIngredientInput[];
};

function viewRowToInput(
  v: RecipeView["sections"][number]["ingredients"][number],
): RecipeIngredientInput {
  return {
    ingredientName: v.ingredientName,
    ingredientId: v.ingredientId,
    unassigned: v.ingredientId == null,
    addAsAlias: false,
    quantity: v.quantity,
    quantityLow: v.quantityLow,
    // Carry the quantifier ref + its source word so an untouched quantifier
    // row keeps its amount when the recipe is rebuilt around a changed line.
    quantifierId: v.quantifierId,
    displayQuantifier: v.quantifierSource,
    unitId: v.unitId,
    displayUnit: v.unitName,
    notes: v.notes,
    isOptional: v.isOptional,
    fixedAmount: v.fixedAmount,
    rawLine: v.rawLine,
    isAlternative: v.alternativeForId != null,
  };
}

/**
 * Rebuild a recipe's {@link RecipeInput} from its current {@link RecipeView},
 * substituting each replacement's row-group (matched by the first present id
 * in `replaceRowIds`) with the replacement's `rows`, and mapping every other
 * row through unchanged. Order and sections are preserved; replaced rows keep
 * their `rawLine` (the caller carries it on the new rows). A replacement whose
 * ids are all absent from the recipe is counted in `skipped` and ignored.
 */
export function buildReparsedRecipeInput(
  view: RecipeView,
  replacements: ReparseReplacement[],
): { input: RecipeInput; appliedGroups: number; skipped: number } {
  // Map each current row id → the replacement that owns it.
  const byRowId = new Map<number, ReparseReplacement>();
  for (const rep of replacements) {
    for (const id of rep.replaceRowIds) byRowId.set(id, rep);
  }
  const applied = new Set<ReparseReplacement>();

  const sections = view.sections.map((section) => {
    const ingredients: RecipeIngredientInput[] = [];
    for (const row of section.ingredients) {
      const rep = byRowId.get(row.id);
      if (rep) {
        // First row of this group we encounter → emit the replacement once.
        if (!applied.has(rep)) {
          applied.add(rep);
          for (const r of rep.rows) ingredients.push(r);
        }
        // Skip the current row either way (it belongs to a replaced group).
        continue;
      }
      ingredients.push(viewRowToInput(row));
    }
    return {
      title: section.title,
      instructions: section.instructions,
      ingredients,
    };
  });

  const input: RecipeInput = {
    title: view.title,
    description: view.description,
    servings: view.servings,
    prepTimeMin: view.prepTimeMin,
    cookTimeMin: view.cookTimeMin,
    sourceUrl: view.sourceUrl,
    photoPath: view.photoPath,
    tags: view.tags,
    sections,
  };
  return {
    input,
    appliedGroups: applied.size,
    skipped: replacements.length - applied.size,
  };
}
