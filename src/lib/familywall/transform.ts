/**
 * Pure transformation: one {@link FamilywallRawRecipe} → one `RecipeInput`
 * that `createRecipe` accepts. No DB writes, no HTTP, no photos.
 *
 * The orchestrator is responsible for:
 *   - building the unit + ingredient lookup maps once
 *   - downloading + storing the photo (so `photoPath` is set when passed in)
 *
 * Anything that can't be resolved is left null/empty rather than guessed —
 * we trust the existing `createRecipe` flow to auto-create ingredients and
 * tolerate missing units/notes.
 */

import {
  mergeIngredientAndInstructionSections,
  parseIngredientLinesIntoSections,
  parseInstructionsIntoSections,
  type ParseLookups,
} from "../recipe-import/index.ts";
import type { RecipeInput } from "../recipes/types.ts";
import type { FamilywallRawRecipe } from "./types.ts";

/**
 * Strip any existing leading step-number marker from a single step, so we
 * don't double-number ("1. Heat oil" + our "1. " prefix → "1. 1. Heat oil").
 * Recognises:
 *   "1." / "1)" / "1:" — bare numeric marker
 *   "Step 1." / "Schritt 1:" — labelled marker
 * The marker must be followed by whitespace, which keeps real content like
 * "1.5 cups" / "1 minute later" from being eaten.
 */
function stripStepNumber(s: string): string {
  return s.replace(/^\s*(?:step\s+|schritt\s+)?\d+\s*[.):\]]+\s+/i, "");
}

/**
 * Render the step list as a markdown ordered list. Always uses `1.`, `2.`,
 * … even when there's a single step — that way the rendered recipe shows
 * the same structure regardless of how many steps Familywall had, and the
 * markdown editor parses it as a proper ordered list.
 */
function joinInstructions(steps: string[]): string {
  const cleaned = steps
    .map((s) => s.replace(/\s+/g, " ").trim())
    .map(stripStepNumber)
    .filter((s) => s.length > 0);
  if (cleaned.length === 0) return "";
  return cleaned.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

const FAVORITE_TAG = "Familywall-Favorit";

/**
 * Familywall-specific section-header keywords. Users routinely type these
 * as standalone lines inside the ingredient list to group what follows
 * ("Teig", then the dough ingredients; "Füllung", then the filling) —
 * without a trailing colon, without leading dashes, in mixed case — so the
 * generic `detectSectionHeader` in recipe-import doesn't catch them and
 * they end up persisted as ingredient rows ("Beilage", "Teig", …).
 *
 * Scoped to the familywall importer on purpose: other sources (URL paste,
 * JSON-LD, manual entry) routinely use the same words as actual ingredient
 * names ("Sauce nach Wahl", "Salat" = lettuce), and a global promotion
 * would silently drop those rows. The list is the union of single-word
 * ingredient names we observed in the cached familywall recipes that were
 * always used as group labels, never as products.
 *
 * "Salat" and "Aufstrich" are deliberately excluded — they appear as real
 * ingredients in the cache (e.g. "Salat" = lettuce on a sandwich recipe).
 */
const FAMILYWALL_SECTION_KEYWORDS = new Set([
  "arbeitsfläche",
  "beilage",
  "deko",
  "dressing",
  "salatdressing",
  "sauce",
  "soße",
  "teig",
  "füllung",
  "marinade",
  "glasur",
  "guss",
  // English forms that show up in user-pasted English recipes
  "topping",
  "toppings",
  "filling",
  "crust",
  "pastry",
  "garnish",
]);

/**
 * Matches lowercase "für die/den/das X" / "for the X" / "zum X" headers
 * without a trailing colon (uppercase / colon-terminated variants are
 * already handled by `detectSectionHeader`). Limited to short headers
 * (≤5 tokens) so a recipe row like "für die Marinade Olivenöl und Salz
 * vermischen" — if it ever leaks into ingredients — doesn't get promoted.
 */
const FAMILYWALL_HEADER_PREFIX_RE =
  /^(?:für\s+(?:die|den|das)|for\s+the|zum)\s+\S+(?:\s+\S+){0,4}$/iu;

/**
 * Personal-name suffixes the user appends to ingredient lines to mark a row
 * as belonging to a specific household member's preference: "Beilage für
 * Janine", "Dressing Steven", … The catalog has `Beilage` and `Dressing` as
 * real ingredients — what we want is for the head word to match cleanly and
 * the personal name to land in the row's notes column.
 *
 * Mechanism: wrap the trailing "für X" / "X" suffix in parens, which the
 * downstream parser already extracts as notes. So "Beilage für Janine" →
 * "Beilage (für Janine)" → name "Beilage", notes "für Janine".
 *
 * Limited to the two household members in the cache — broaden if the user
 * ever introduces a third name.
 */
const FAMILYWALL_PERSONAL_LABELS = ["Janine", "Steven"];

const FAMILYWALL_PERSONAL_LABEL_RE = new RegExp(
  `\\s+((?:für\\s+)?(?:${FAMILYWALL_PERSONAL_LABELS.join("|")}))\\s*$`,
  "i",
);

/**
 * Rewrite trailing personal-name suffixes into a paren-note so the parser
 * picks them up as ingredient notes rather than letting them pollute the
 * matched name. See `FAMILYWALL_PERSONAL_LABELS`.
 */
export function rewriteFamilywallPersonalLabels(lines: string[]): string[] {
  return lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return line;
    const m = trimmed.match(FAMILYWALL_PERSONAL_LABEL_RE);
    if (!m) return line;
    const head = trimmed.slice(0, m.index).trim();
    if (head.length === 0) return line;
    return `${head} (${m[1]})`;
  });
}

/**
 * Brand prefixes that, when leading an ingredient line, get rewritten as a
 * trailing paren-note. "Hensslers Gewürzsalz" → "Gewürzsalz (Hensslers)" —
 * the parser's existing paren-as-notes mechanism then surfaces the brand
 * on the row's notes, and the bare "Gewürzsalz" gets a normal catalog
 * match (e.g. routing to Salz).
 *
 * Matched longest-first, case-sensitive — these are brand names so the
 * casing the source uses is a reliable signal. Add an entry when a brand
 * shows up enough that orphans cluster around it.
 */
const FAMILYWALL_BRAND_PREFIXES: readonly string[] = [
  "Original Miracel Whip",
  "Mein Mildessa",
  "Diamond Crystal",
  "The Fillo Factory",
  "Dr. Oetker",
  "Hensslers",
  "Tillamook",
  "Valrhona",
  "Hengstenberg",
  "Mildessa",
  "Boursin",
  "Alpro",
];

/**
 * Rewrite "BrandName actual ingredient ..." into "actual ingredient ...
 * (BrandName)". The brand becomes a paren-note the parser converts into
 * the row's `notes`. Leaves the line alone when:
 *  - no brand prefix matches
 *  - the candidate after stripping is empty (line was just the brand —
 *    no useful catalog match possible anyway; let the orphan stand)
 *  - the line already has parens (don't disturb existing annotations)
 */
export function rewriteFamilywallBrands(lines: string[]): string[] {
  // Sort longest-first so multi-word brands ("Original Miracel Whip")
  // don't get partially matched by a substring brand ("Mildessa" inside
  // "Mein Mildessa").
  const prefixes = [...FAMILYWALL_BRAND_PREFIXES].sort(
    (a, b) => b.length - a.length,
  );
  return lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return line;
    if (trimmed.includes("(")) return line;
    for (const prefix of prefixes) {
      // Match brand at the start of the candidate name area. Quantity /
      // unit can still precede the brand ("4 EL Hensslers Bratöl") —
      // detect the brand anywhere up to a leading numeric+unit chunk
      // via a simple word-boundary check.
      const re = new RegExp(
        `(?:^|\\s)(${prefix.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")})\\b(\\s+\\S+)`,
        "u",
      );
      const m = trimmed.match(re);
      if (!m) continue;
      const before = trimmed.slice(0, m.index).trimEnd();
      const after = trimmed.slice((m.index ?? 0) + m[0].length).trim();
      const matchedSuffix = m[2].trim();
      const productPart = `${matchedSuffix}${after ? " " + after : ""}`.trim();
      if (productPart.length === 0) return line;
      const combined = `${before ? before + " " : ""}${productPart} (${prefix})`;
      return combined;
    }
    return line;
  });
}

/**
 * Apple-variety descriptors that appear next to "Apfel"/"Äpfel"/"apple(s)"
 * in familywall recipes (Gala, Granny Smith, …). Wrapped in parens before
 * parsing so the existing paren-as-notes mechanism extracts them as the
 * row's notes — leaving a bare "Apfel" / "apples" candidate that
 * full-coverage-matches the catalog's single `Apfel` canonical.
 *
 * Apple-only because the matcher's threshold deliberately blocks
 * 1-token-at-pos-0 matches from collapsing distinct products
 * (`Paprikapulver` inside `Paprikapulver edelsüß`). A general "strip
 * descriptors near heads" mechanism would need per-canonical knowledge
 * of which trailing tokens are identity vs descriptor; we punt on that
 * and special-case the cases we actually see. Extend `APPLE_VARIETIES`
 * as more variants appear in the cache.
 */
const APPLE_VARIETIES = [
  "Granny Smith",
  "Pink Lady",
  "Red Delicious",
  "Gala",
  "Honeycrisp",
  "Boskoop",
  "Jonagold",
  "Braeburn",
  "Fuji",
  "Elstar",
  "Cox",
];

const APPLE_HEAD = "(?:Apfel|Äpfel|apples?)";

// Variety AFTER the head: "Apfel Gala", "apple Boskoop", "Apfel Sorte
// Boskoop". The optional connector "Sorte"/"variety" gets dropped along
// with the variety being moved into parens.
const APPLE_VARIETY_AFTER_RE = new RegExp(
  `\\b(${APPLE_HEAD})\\s+(?:Sorte\\s+|variety\\s+)?(${APPLE_VARIETIES.join("|")})\\b`,
  "gi",
);

// Variety BEFORE the head: "Pink Lady apples", "Granny Smith apple".
// Note: alternatives in `APPLE_VARIETIES` are ordered longest-first so the
// regex engine prefers "Granny Smith" / "Pink Lady" over a hypothetical
// shorter prefix match.
const APPLE_VARIETY_BEFORE_RE = new RegExp(
  `\\b(${APPLE_VARIETIES.join("|")})\\s+(${APPLE_HEAD})\\b`,
  "gi",
);

/**
 * Move apple-variety descriptors into a paren-note. See
 * `APPLE_VARIETIES`.
 */
export function rewriteFamilywallAppleVarieties(lines: string[]): string[] {
  return lines.map((line) => {
    let out = line.replace(APPLE_VARIETY_AFTER_RE, "$1 ($2)");
    out = out.replace(APPLE_VARIETY_BEFORE_RE, "$2 ($1)");
    return out;
  });
}

/**
 * In English recipes "1 tsp paprika" means the powder; in German recipes
 * "1 Paprika" / "1 rote Paprika" is the fresh bell pepper. Familywall users
 * mix both languages freely, so the parser would otherwise collapse the
 * spoon-unit lines into the bell-pepper canonical via the generic catalog.
 *
 * Disambiguator: when the unit immediately preceding "Paprika" is a small
 * spoon-or-pinch volume unit (TL/EL/tsp/tbsp/Prise/Msp), rewrite the word
 * to "Paprikapulver" so the matcher resolves it to the powder canonical.
 * Mass units (g, kg) are deliberately NOT in the list — 200g of paprika
 * could plausibly be bell peppers.
 *
 * Scoped to familywall because other importers' recipes are usually
 * already disambiguated.
 */
const PAPRIKA_AS_POWDER_RE =
  /\b((?:TL|EL|Teelöffel|Esslöffel|tsp|tbsp|teaspoon|teaspoons|tablespoon|tablespoons|Prise|Prisen|Msp|pinch|pinches)\.?\s+)Paprika\b/gi;

/**
 * Apply familywall-specific name disambiguations. Currently: Paprika → Paprikapulver
 * when preceded by a spoon/pinch unit. The matcher then resolves the line to
 * the powder canonical rather than the fresh pepper.
 */
export function disambiguateFamilywallNames(lines: string[]): string[] {
  return lines.map((line) => line.replace(PAPRIKA_AS_POWDER_RE, "$1Paprikapulver"));
}

/**
 * Promote familywall lines that *look* like a section header but aren't
 * caught by the generic detector. The cheapest way to integrate is to
 * append a colon — `detectSectionHeader` then recognises the line as a
 * header during the regular parse, with no special-case branching in the
 * parser itself.
 */
export function promoteFamilywallSectionHeaders(lines: string[]): string[] {
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return line;
      // Drop servings/portion metadata that familywall renders as an
      // ingredient line ("Für 2 Personen", "For 4 people"). It's recipe
      // metadata, not a section nor an ingredient.
      if (/^(?:für|for)\s+\d+\s+(?:personen?|people|servings?|portionen?)\s*$/iu.test(trimmed)) {
        return "";
      }
      // Skip anything the generic detector would already accept (avoid
      // double-colon, and leave dash- / emoji- / colon-terminated lines
      // alone).
      if (/:\s*$/.test(trimmed)) return line;
      if (/^[-–—]{2,}/.test(trimmed)) return line;
      // Strip a single trailing parenthetical before keyword-matching so
      // "Deko (getr. Himbeeren, kleine Kekse, etc.)" still promotes to
      // "Deko:" — the paren content is descriptive, not part of the header.
      const head = trimmed.replace(/\s*\([^)]*\)\s*$/, "").trim();
      const lower = head.toLowerCase();
      if (
        FAMILYWALL_SECTION_KEYWORDS.has(lower) ||
        FAMILYWALL_HEADER_PREFIX_RE.test(head)
      ) {
        return `${head}:`;
      }
      return line;
    })
    .filter((line) => line.length > 0);
}

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1));
}

/**
 * Familywall often emits all-caps section titles ("PASTRY", "FILLING") that
 * read better as title-case ("Pastry", "Filling"). Mixed-case titles like
 * "Für den Teig" the user typed themselves are left untouched.
 */
function prettifySectionTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed === trimmed.toLocaleUpperCase("de") ? toTitleCase(trimmed) : trimmed;
}

function dedupeTags(tags: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const trimmed = t.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function transformFamilywallRecipe(
  raw: FamilywallRawRecipe,
  lookups: ParseLookups,
  /** Photo path the orchestrator stored before calling us, or null. */
  photoPath: string | null,
): RecipeInput {
  // Same pipeline as the clipboard-paste and URL-import flows: section
  // header detection (`:`-ending, all-caps, leading dashes/emoji),
  // conjunction splitting ("Salz und Pfeffer" → 2 rows), and the full
  // parseIngredientString with all its noise-stripping + amount-parsing
  // heuristics. Familywall imports get the same treatment as any other
  // source.
  const ingredientGroups = parseIngredientLinesIntoSections(
    disambiguateFamilywallNames(
      promoteFamilywallSectionHeaders(
        rewriteFamilywallAppleVarieties(
          rewriteFamilywallBrands(
            rewriteFamilywallPersonalLabels(raw.ingredients),
          ),
        ),
      ),
    ),
    lookups,
    {
      // Familywall ships an exhaustive curated catalog via the seed step,
      // so we trade the strict global default for tighter behaviour:
      //  - "X oder Y" → X (drop the alternative; first option wins)
      //  - "Weizen- oder Dinkelmehl" expanded to "Weizenmehl"
      //  - adjacent Salz/Pfeffer pairs split into two rows
      //  - relaxed match gate so descriptor compounds collapse into
      //    broader catalog rows instead of orphaning.
      alternativesMode: "first-wins",
      autoMatchScoreThreshold: 130,
    },
  );
  // Instructions can carry their own section headers ("Für den Teig:" then
  // the steps for the dough). Parse them with the same header detector so
  // matching titles end up in the same merged section.
  const instructionGroups = parseInstructionsIntoSections(raw.instructions);

  const merged = mergeIngredientAndInstructionSections(
    ingredientGroups,
    instructionGroups,
    joinInstructions,
  );

  const sections = merged.map((m) => ({
    title: m.title ? prettifySectionTitle(m.title) : null,
    instructions: m.instructions,
    ingredients: m.ingredients.map((p) => {
      const name = p.name.trim().length > 0 ? p.name.trim() : "Unbekannte Zutat";
      const noteParts = [
        p.notes,
        p.rawUnit && !p.unit ? `Einheit: ${p.rawUnit}` : null,
      ].filter((s): s is string => typeof s === "string" && s.length > 0);
      return {
        ingredientName: name,
        // CRITICAL: thread the matcher's resolved ingredient id through to
        // the save payload. Familywall imports go directly into createRecipe
        // without a UI in between, so without this the service's name-based
        // resolveIngredient runs against `parsed.name` (the user's text) —
        // which after Phase A's displayName preservation no longer equals
        // the canonical, so every "Paprika-Pulver" / "Tomaten" row would
        // create a duplicate canonical instead of linking to an existing
        // one. The matcher already picked the right ingredient id.
        ingredientId: p.ingredientId,
        quantity: p.quantity,
        unitId: p.subUnit ? null : p.unit ? p.unit.id : null,
        subUnitId: p.subUnit ? p.subUnit.id : null,
        // Keep the imported unit token verbatim (e.g. "Tasse"). Server NULLs
        // it back out if it equals the canonical unit name. Skipped for
        // sub-units (the sub-unit name is the source of truth).
        displayUnit: p.subUnit ? null : (p.rawUnit ?? null),
        notes: noteParts.length > 0 ? noteParts.join(" – ") : null,
        isOptional: p.isOptional,
        fixedAmount: p.fixedAmount,
        rawLine: p.rawText || null,
      };
    }),
  }));

  // Guarantee at least one section even when the source had zero ingredients —
  // RecipeInput callers expect `sections[0]` to exist.
  if (sections.length === 0) {
    sections.push({
      title: null,
      instructions: joinInstructions(raw.instructions),
      ingredients: [],
    });
  }

  return {
    title: raw.title.trim() || "Importiertes Rezept",
    description: raw.description?.trim() || null,
    servings: raw.servings && raw.servings > 0 ? Math.round(raw.servings) : 1,
    prepTimeMin: raw.prepTimeMin,
    cookTimeMin: raw.cookTimeMin,
    // The user explicitly asked: never store a link back to Familywall. Only
    // the recipe's own original source URL (which Familywall may carry as a
    // separate field) is allowed here.
    sourceUrl: raw.sourceUrl?.trim() || null,
    photoPath,
    tags: dedupeTags([
      ...raw.tags,
      ...(raw.isFavorite ? [FAVORITE_TAG] : []),
    ]),
    sections,
  };
}
