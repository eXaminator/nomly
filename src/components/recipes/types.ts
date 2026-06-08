import type { ComboboxItem } from "@/components/ui/combobox";

/**
 * Per-row state surfaced after a URL import: what matched, what didn't,
 * what we defaulted. The form renders small badges off these flags so the
 * user can see at a glance which rows need attention. Cleared as soon as
 * the user edits the relevant field (handled in `IngredientRow`).
 */
export type ImportAnnotation = {
  /** True when the ingredient name didn't match any existing row — it'll be
   *  created when the recipe is saved. */
  ingredientIsNew: boolean;
  /** "ok" — the unit resolved cleanly.
   *  "defaulted" — no unit was parsed; we defaulted to Stück.
   *  "unresolved" — a unit token was parsed but didn't resolve.
   *  "empty" — no quantity, no unit. */
  unitState: "ok" | "defaulted" | "unresolved" | "empty";
  /** The non-canonical unit token that the importer saw, when it differs
   *  from the resolved canonical (an alias hit) or couldn't be resolved
   *  at all. Null for clean direct matches and defaulted rows. */
  rawUnit: string | null;
};

export type DraftIngredientCandidate = {
  ingredientId: number;
  /** Canonical name of the matched ingredient (the underlying identity). */
  canonicalName: string;
  /** Name of the catalog row that actually matched — the alias name when
   *  the hit came via an alias, otherwise equal to `canonicalName`. The
   *  pill UI displays this so the user can see WHY a row matched (e.g. a
   *  recipe says "Erbsen, TK", the matcher hits the alias "TK Erbsen" of
   *  canonical "Erbsen", and the pill reads "TK Erbsen"). */
  matchedName: string;
  /** Match score from the server-side matcher. Used purely for sort
   *  stability and the auto-select rules; never rendered to the user. */
  score: number;
  /** Finished display name to apply if the user picks this pill — the
   *  matched span of the input. Selecting a pill is a pure replace. */
  name: string;
  /** Finished notes to apply if the user picks this pill — the input tokens
   *  outside the matched span plus the parser's base notes. */
  notes: string | null;
  /** True when the underlying ingredient is flagged as equipment — the pill
   *  click handler and auto-select rule default `isOptional` to true. */
  isEquipment: boolean;
};

export type DraftIngredient = {
  uid: string;
  /** Freeform name — what the recipe row displays. NOT directly used for
   *  ingredient identity (that's `selectedIngredientId`); on save it becomes
   *  the row's `display_name`. */
  name: string;
  /** Canonical name of the selected ingredient when it differs from
   *  `name`. Shown as a small pill under the input. Cleared on edit. */
  canonicalName: string | null;
  /** The user's ORIGINAL spelling before the parser's auto-match replaced it
   *  with the catalog alias ("Zwiebeln" → display became "Zwiebel"). Set on
   *  import (from the parser's source span) and when a candidate pill replaces
   *  the name (captures the prior text). Cleared when the user types a fresh
   *  name. Powers the "keep my spelling & add as alias" toggle so it offers
   *  the original, not the parser-substituted, name. UI-only — never persisted. */
  originalName?: string;
  /** Pre-resolved ingredient id chosen via the pill UI. `null` means "save
   *  as new ingredient with `name`". Auto-set by the matcher when text
   *  changes; manually-set when the user clicks a candidate pill. */
  selectedIngredientId: number | null;
  /** Candidate ingredient matches for the current `name`. Re-fetched on
   *  text change (debounced). The selected pill is highlighted in the UI. */
  candidates: DraftIngredientCandidate[];
  /** When true, force-match was used AND the user opted to persist the
   *  current `name` as an alias of `selectedIngredientId` on save. */
  addAsAlias: boolean;
  /** "Nicht zugeordnet" pill: the row is free text not linked to any article.
   *  Mutually exclusive with a selected/new ingredient — picking this pill
   *  clears `selectedIngredientId` and `canonicalName`. Saved as
   *  `unassigned: true` (server persists `ingredient_id` NULL) and the line
   *  never reaches a shopping list. */
  unassigned: boolean;
  quantity: string;
  unit: ComboboxItem | null;
  notes: string;
  /** When true, the row renders dimmed/italic in the read view and is skipped
   *  by the shopping-list builder. Edited via a per-row toggle. */
  isOptional: boolean;
  /** When true, the quantity is treated as portion-independent — changing a
   *  planned meal's servings does not rescale this ingredient. */
  fixedAmount: boolean;
  /** Original source substring (after table pairing / conjunction splitting,
   *  before quantity-unit-notes extraction). Populated by the URL importer
   *  and the clipboard parser so the import-review UI can show the user what
   *  the parser was working from. Undefined for manually-added rows and for
   *  rows loaded from an existing recipe. */
  rawText?: string;
  /** Char range `[start, end)` of this row's own segment within `rawText`.
   *  For an alternative it includes the connector ("oder Ahornsirup"). Used to
   *  fold the alternative back into the primary's notes on removal. Parse-
   *  session only — absent for rows loaded from a saved recipe. */
  sourceRange?: [number, number];
  /** Categorised highlight spans into `rawText` (own amount/name/note +
   *  inherited amount/note) — coloured by kind in the "Original:" line so the
   *  parse decisions are legible. Parse-session only. */
  highlightParts?: { range: [number, number]; kind: "amount" | "name" | "note" }[];
  importAnnotation?: ImportAnnotation;
  /** When true, this row is an alternative for the most recent
   *  non-alternative row above it in the same section. Rendered indented
   *  under its primary; always optional. Sent to the server as
   *  `isAlternative: true` so the service layer resolves it to a real
   *  `recipe_ingredient.alternative_for_id` linking to the primary's
   *  inserted id. */
  isAlternative: boolean;
  /** True once the user has manually pinned a specific ingredient via a
   *  candidate pill / force-match / ↻ / "Neu". While pinned, typing in the
   *  name field does NOT re-run auto-select (the pin is sticky). Picking a
   *  different item from the name autocomplete clears the pin and re-selects
   *  the best match. Import auto-resolution is NOT a pin. UI-only — never
   *  persisted. */
  pinnedByUser?: boolean;
};

/**
 * The text the live ingredient matcher (`/api/v1/ingredients/match`) should
 * run against for a row.
 *
 * Primary rows query their full source line (`rawText`) so the matcher sees
 * the whole context — quantity, size, comma-tail ("1 medium tomato, diced"
 * keeps "medium" out of the name). Alternative rows must NOT: their `rawText`
 * is the entire "X or Y" line they were split from, and `/match` only returns
 * the FIRST parsed row's candidates. Querying that full line surfaces the
 * PRIMARY's matches, so the alternative's own ingredient falls out of the pill
 * list — the UI then pins it via the bare-canonical fallback, dropping the
 * matched alias (e.g. "Hähnchenkeule" instead of "Hähnchenkeule (drumstick)").
 * Query the alternative's own fragment instead: its original source span,
 * falling back to its display name.
 */
export function liveMatchQuery(
  value: Pick<
    DraftIngredient,
    "isAlternative" | "rawText" | "name" | "originalName"
  >,
): string {
  if (value.isAlternative) return value.originalName ?? value.name;
  return value.rawText ?? value.name;
}

export type DraftSection = {
  uid: string;
  title: string;
  instructions: string;
  ingredients: DraftIngredient[];
};

export type DraftRecipe = {
  title: string;
  description: string;
  servings: string;
  prepTimeMin: string;
  cookTimeMin: string;
  sourceUrl: string;
  photoPath: string | null;
  /** Image URL the server should download on save. When non-empty it takes
   *  precedence over photoPath. */
  photoUrl: string;
  tags: string[];
  sections: DraftSection[];
};

/**
 * Wire shape returned by the URL importer and the clipboard parser. Matches
 * `ImportedIngredient` server-side — kept in lockstep manually so client
 * code doesn't pull a server-side type. Both endpoints are populated by
 * `parseIngredientLines` so the conversion below applies uniformly.
 */
export type ParsedIngredientResponse = {
  quantity: number | null;
  unit: { id: number; name: string } | null;
  unitMatch: "matched" | "defaulted" | "unresolved" | "empty";
  rawUnit: string | null;
  name: string;
  ingredientId: number | null;
  ingredientMatch: "existing" | "new";
  canonicalIngredientName: string | null;
  /** The original source span the matched alias replaced ("Zwiebeln" when
   *  `name` became the alias "Zwiebel"). Lets the import-review UI offer the
   *  user's own spelling as the alias to remember. Null on the new path. */
  sourceName?: string | null;
  /** Ranked candidate matches from the substring matcher, already sorted
   *  server-side (score desc → alias-length desc → alphabetical). The pill
   *  UI renders these in order. */
  candidateMatches?: Array<{
    ingredientId: number;
    canonicalName: string;
    matchedName: string;
    score: number;
    name: string;
    notes: string | null;
    isEquipment: boolean;
  }>;
  notes: string | null;
  /** Server marked the row as optional from an "opt." / "Optional:" /
   *  "evtl." / "(optional)" marker in the source. */
  isOptional?: boolean;
  /** Server marked the row's amount as fixed (no portion scaling). Auto-set
   *  on import for entries with no parsed quantity. */
  fixedAmount?: boolean;
  /** Source substring the parser worked from (after table pairing /
   *  conjunction splitting). Surfaced under the row in the import-review UI. */
  rawText?: string;
  /** Server marked the row as an alternative of its preceding primary
   *  (parsed from `alternativ:` / `(Alternativ: X)`). Pairs with
   *  `isOptional: true`. */
  isAlternative?: boolean;
  /** Char range `[start, end)` of this row's own segment within `rawText`
   *  (the original line). For an alternative it includes the connector.
   *  Drives fold-back-on-removal. */
  sourceRange?: [number, number];
  /** Categorised highlight spans into `rawText` (own amount/name/note +
   *  inherited amount/note) — coloured by kind in the source-line view. */
  highlightParts?: { range: [number, number]; kind: "amount" | "name" | "note" }[];
};

export function parsedIngredientToDraft(
  i: ParsedIngredientResponse,
): DraftIngredient {
  // "matched" collapses to the "ok" annotation state; the badge reads
  // `rawUnit` separately when an alias-hit needs surfacing.
  const unitState: ImportAnnotation["unitState"] =
    i.unitMatch === "matched" ? "ok" : i.unitMatch;
  const annotation: ImportAnnotation = {
    ingredientIsNew: i.ingredientMatch === "new",
    unitState,
    // For clean alias hits we now route the alias name into the picker
    // itself (see `unitDisplayName` below), so clearing rawUnit here keeps
    // the badge from showing the same text twice.
    rawUnit: i.unitMatch === "matched" ? null : i.rawUnit,
  };
  // When the parser resolved the unit via an alias (e.g. source said "Tasse"
  // for canonical "Cup"), keep the alias as the displayed unit so the saved
  // recipe reads as the source intended.
  const unitDisplayName =
    i.unit !== null
      ? i.rawUnit && i.unitMatch === "matched"
        ? i.rawUnit
        : i.unit.name
      : null;
  // Carry the original source spelling only when the parser actually
  // substituted a different display name (matched via an alias / inflection),
  // so the import-review UI can offer it as the alias to remember.
  const originalName =
    i.sourceName && i.sourceName.trim().toLowerCase() !== i.name.trim().toLowerCase()
      ? i.sourceName.trim()
      : undefined;
  return {
    uid: crypto.randomUUID(),
    name: i.name,
    canonicalName: i.canonicalIngredientName,
    originalName,
    selectedIngredientId: i.ingredientId,
    candidates: (i.candidateMatches ?? []).map((c) => ({
      ingredientId: c.ingredientId,
      canonicalName: c.canonicalName,
      matchedName: c.matchedName,
      score: c.score,
      name: c.name,
      notes: c.notes ?? null,
      isEquipment: c.isEquipment ?? false,
    })),
    addAsAlias: false,
    // Import never auto-produces unassigned rows — it always tries to match.
    unassigned: false,
    quantity: quantityToInputString(i.quantity),
    unit:
      i.unit && unitDisplayName !== null
        ? { id: i.unit.id, name: unitDisplayName }
        : null,
    notes: i.notes ?? "",
    isOptional: i.isOptional ?? false,
    fixedAmount: i.fixedAmount ?? false,
    isAlternative: i.isAlternative ?? false,
    rawText: i.rawText,
    sourceRange: i.sourceRange,
    highlightParts: i.highlightParts,
    importAnnotation: annotation,
  };
}

/**
 * Format a stored numeric quantity for the German-language quantity input.
 * Outputs "1,5" (not "1.5") so the user sees the same convention they typed.
 * Returns "" for null. Preserves precision (no rounding) — round-trip:
 * input.toString() ↔ display.
 */
export function quantityToInputString(q: number | null): string {
  if (q === null) return "";
  // Intl.NumberFormat with a high digit cap keeps full precision while
  // emitting the German decimal comma. useGrouping=false to suppress
  // thousands separators (a 1234 g ingredient should show "1234", not "1.234").
  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 20,
    useGrouping: false,
  }).format(q);
}

export function emptyIngredient(): DraftIngredient {
  return {
    uid: crypto.randomUUID(),
    name: "",
    canonicalName: null,
    selectedIngredientId: null,
    candidates: [],
    addAsAlias: false,
    unassigned: false,
    quantity: "",
    unit: null,
    notes: "",
    isOptional: false,
    fixedAmount: false,
    isAlternative: false,
  };
}

/**
 * Empty draft for a new alternative row. Always starts isOptional+isAlternative
 * true so the row is born linked to its primary and excluded from the
 * shopping-list default.
 */
export function emptyAlternative(): DraftIngredient {
  return {
    ...emptyIngredient(),
    isOptional: true,
    isAlternative: true,
  };
}

export function emptySection(): DraftSection {
  return {
    uid: crypto.randomUUID(),
    title: "",
    instructions: "",
    ingredients: [emptyIngredient()],
  };
}

/**
 * Initial state for the "neues Rezept" form. Uses deterministic UIDs so
 * server-rendered HTML and the first client render produce the same htmlFor /
 * id attributes — random UUIDs would diverge and abort React hydration,
 * silently breaking every event handler in the form (including
 * `Abschnitt hinzufügen` and `PhotoUpload`'s file picker). Items the user
 * adds at runtime stay on `crypto.randomUUID()` because those callsites only
 * fire client-side.
 */
export function emptyRecipe(): DraftRecipe {
  return {
    title: "",
    description: "",
    servings: "4",
    prepTimeMin: "",
    cookTimeMin: "",
    sourceUrl: "",
    photoPath: null,
    photoUrl: "",
    tags: [],
    sections: [
      {
        uid: "initial-section",
        title: "",
        instructions: "",
        ingredients: [
          {
            uid: "initial-ingredient",
            name: "",
            canonicalName: null,
            selectedIngredientId: null,
            candidates: [],
            addAsAlias: false,
            unassigned: false,
            quantity: "",
            unit: null,
            notes: "",
            isOptional: false,
            fixedAmount: false,
            isAlternative: false,
          },
        ],
      },
    ],
  };
}
