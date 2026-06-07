/**
 * Heuristic parser for an ingredient string of the form
 *   "500 g Hackfleisch, fein gewürfelt"
 * → { quantity: 500, unit: "g", name: "Hackfleisch", notes: "fein gewürfelt" }
 *
 * Designed for German recipe sources (Chefkoch, Lecker, …) but tolerates the
 * common English forms found in JSON-LD too. The unit string is returned
 * verbatim; the caller passes the controlled vocabulary (`knownUnitTokens`)
 * so adding a new alias to the DB automatically teaches the parser the new
 * token.
 */

const FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

export type ParsedIngredient = {
  quantity: number | null;
  unitName: string | null;
  name: string;
  /**
   * The portion of the input that ended up in notes via a comma / dash /
   * usage-prefix boundary (i.e. things the user separated from the name with
   * punctuation, but NOT things hoisted out of parens / brackets / "to
   * taste" phrases). The ingredient matcher treats commas as whitespace, so
   * it joins `name + " " + commaTailText` to find aliases like
   * `Paprikapulver rosenscharf` regardless of whether the source wrote a
   * comma between them.
   */
  commaTailText: string;
  notes: string | null;
  /** True when the source marked the ingredient as optional ("opt. 2 EL …",
   * "Optional: …", "evtl.", "(optional)", "nach Belieben", "wenn vorhanden",
   * "if available", "bei Bedarf", "ggf."). Plumbed through to the recipe
   * draft so the row is saved with isOptional=true. */
  isOptional: boolean;
  /**
   * Alternative name + notes where leading cooking-prep adjectives/adverbs
   * have been peeled off the front of the name and pushed to the notes.
   * Set when the name area starts with one or more prep tokens. Null when
   * there's nothing to strip.
   *
   * The caller (parseIngredientLines) decides which form to use based on
   * container context + ingredient-lookup match:
   *   - container present in the line: use full name (no strip)
   *   - full name already matches an ingredient/alias: use full name
   *   - else: use this alternative
   */
  altWithPrepStripped: { name: string; notes: string | null } | null;
  /**
   * Note fragments split out so the matched path can reassemble notes in the
   * SOURCE order of the original line:
   *   - `leadingNotes`: range / size / secondary-amount notes that sit with
   *     the quantity at the front ("2-3", "groß").
   *   - `nameAreaNotes`: parenthetical notes that appeared INSIDE the name
   *     area, each tagged with `afterText` = the name-area prefix that
   *     preceded it ("…peanut butter-no sugar added (crunchy…)" →
   *     { afterText: "…peanut butter-no sugar added", text: "crunchy…" }).
   *     Stored as text (not a token index) so the matched path can re-tokenise
   *     it the SAME way as the match candidate — the parser and the matcher
   *     split dashes differently, so a raw index would drift.
   *   - `postCommaNotes`: notes after the first top-level comma (the
   *     comma-tail + any parens/usage after it), already in source order.
   *   - `trailingNotes`: notes hoisted out of position by preprocess
   *     (brackets, "to taste", optional-parens) — appended last.
   *   - `nameTokenCount`: number of tokens in the final name area, so the
   *     matcher's covered indices can be mapped back to name positions.
   */
  leadingNotes: string[];
  nameAreaNotes: { afterText: string; text: string }[];
  postCommaNotes: string;
  trailingNotes: string[];
  nameTokenCount: number;
};

/**
 * Text amount tokens that mean "one" — common in pasted recipes:
 * "Eine Prise Salz", "a pinch of nutmeg", "ein TL Honig".
 * Matched case-insensitively; the token IS consumed (the amount becomes 1).
 */
const TEXT_AMOUNT_ONE = new Set([
  "ein",
  "eine",
  "einen",
  "einem",
  "einer",
  "eins",
  "a",
  "an",
]);

/**
 * Approximate-quantity tokens that should be stripped before the numeric
 * matcher runs ("ca. 300 ml", "about 2 cups", "approximately 1 tbsp").
 * Also covers "je" ("each", "per") and the optional/alternative leaders that
 * recipe sources sprinkle before the amount ("opt. 2 EL", "optional 1 TL").
 */
const APPROX_TOKENS_RE = /^(ca\.?|etwa|about|approx\.?|approximately|roughly|ungefähr|je|alternativ|alternative)$/i;

/**
 * Text amounts that mean exactly 1/2. "halber Apfel" → quantity 0.5.
 */
const TEXT_AMOUNT_HALF = new Set([
  "halber",
  "halbe",
  "halbes",
  "halben",
  "half",
]);

/**
 * Text amounts that mean exactly 1/4. "viertel TL" → quantity 0.25. The
 * German noun form ("ein Viertel") and the bare adjective ("viertel") both
 * land here; case is already lowered before lookup.
 */
const TEXT_AMOUNT_QUARTER = new Set([
  "viertel",
  "viertels",
  "quarter",
]);

/**
 * Leading preparation nouns that describe what we're using *from* an
 * ingredient rather than the ingredient itself: "Saft einer halben Zitrone"
 * → 0.5 Zitrone, notes "Saft". The noun is moved to notes and the parser
 * then sees the remaining "(von|einer|...) halben Zitrone" fragment.
 *
 * Kept conservative: every entry here MUST be a word that doesn't itself
 * appear as the start of a real ingredient name (so e.g. "Blätter" is not
 * included — "Blätter Petersilie" is a quantity, not a preparation phrase).
 */
const PREP_LEADING_NOUNS = new Set([
  "saft",
  "schale",
  "abrieb",
  "zest",
  "juice",
  "peel",
  "rind",
]);

/**
 * Tokens that legitimately follow a preparation noun and that we want to
 * recognise as "yes, this really is a preparation phrase". Without one of
 * these next, "Saft" / "Schale" stays untouched as the ingredient name.
 */
const PREP_FOLLOWUP_TOKENS = new Set([
  "von",
  "vom",
  "of",
  "from",
  "ein",
  "eine",
  "einer",
  "eines",
  "einem",
  "einen",
  "a",
  "an",
  "der",
  "die",
  "das",
  "des",
  "dem",
  "den",
  "the",
]);

/**
 * Text amount tokens that mean "a small unspecified quantity". They produce
 * `quantity = null` and the matched word becomes part of the notes. Covers
 * "Etwas Salz", "some pepper", "a little bit of …".
 */
const TEXT_AMOUNT_VAGUE = new Set([
  "etwas",
  "some",
  "ein wenig",
  "a little",
  "a bit",
  "a touch",
]);

/**
 * Words that, when they appear standalone in the name area, mark the
 * boundary into "notes" — typically a list of alternatives or examples
 * ("Butter oder Margarine", "Salz z.B. Meersalz"). The matched word
 * itself is preserved in the notes so a reader still sees the relationship.
 */
const NOTE_BOUNDARY_TOKENS = new Set(
  [
    // "or"/"oder" intentionally NOT in this list — recipe sources commonly
    // write "6 dried or fresh shiitake mushrooms" or "Butter oder Margarine"
    // as ALTERNATIVES for the same ingredient slot, and treating "or" as a
    // notes boundary truncates the name to the first adjective. Alternatives
    // stay in the name verbatim.
    "alternative",
    "alternativ",
    "bzw",
    "bzw.",
    "z.b.",
    "z.b",
    "zb",
    "ggf",
    "ggf.",
  ].map((t) => t.toLowerCase()),
);

/**
 * "Zum X" / "for X" suffix tokens — when the parser sees one of these
 * starting in the name area, everything from that point on is a note about
 * how the ingredient is used. Examples: "Puderzucker zum Bestreuen",
 * "olive oil for drizzling".
 */
const USAGE_PREFIX_TOKENS = new Set([
  "zum",
  "zur",
  "for",
  "fürs",
  "für",
]);

/**
 * Filler words to drop between a unit and the ingredient name —
 * "100g of caster sugar" → ignore "of"; same for German "100g von Zucker".
 * Also stripped from the very start of the input (before quantity parsing)
 * so leading conjunctions like "and Salt" / "und Pfeffer" don't pollute
 * the name.
 */
const NAME_FILLER_TOKENS = new Set([
  "of",
  "von",
  "vom",
  "and",
  "und",
  "the",
  "der",
  "die",
  "das",
  // Leading "plus" / "to" from chained ingredient writeups
  // ("plus 1 tsp brown sugar", "to ½ tsp red pepper flakes").
  "plus",
  "to",
]);

/**
 * Size modifiers that may sit between the quantity and the unit:
 * "1 kl. Dose Bohnen", "1 große Tasse Milch". We pull them out so the
 * unit-recogniser can see the bare unit ("Dose", "Tasse"), and append
 * the modifier to the notes so the reader keeps the size hint.
 *
 * Compared case-insensitively against the token with any trailing
 * period stripped — so both "kl." and "kl" match.
 */
export const SIZE_MODIFIER_TOKENS = new Set([
  "kl",
  "kleine",
  "kleiner",
  "kleines",
  "klein",
  "gr",
  "große",
  "großer",
  "großes",
  "groß",
  "grosse",
  "grosser",
  "grosses",
  "gross",
  "mittl",
  "mittlere",
  "mittlerer",
  "mittleres",
  "mittel",
  // Compound "mittelgroß" + inflections. The bare "mittel" above covers
  // single-word "mittel große", but most recipes use the closed compound.
  "mittelgroß",
  "mittelgroße",
  "mittelgroßer",
  "mittelgroßes",
  "mittelgroßen",
  "mittelgross",
  "mittelgrosse",
  "mittelgrosser",
  "mittelgrosses",
  "mittelgrossen",
  // English size descriptors. Like the German set, these describe which
  // specimen to grab, not what to buy — strip to notes.
  "large",
  "medium",
  "small",
  "big",
  "jumbo",
  "tiny",
  "huge",
  // "gestrichener TL" / "gehäufter TL" — fill-level modifiers.
  "gestrichen",
  "gestrichene",
  "gestrichener",
  "gestrichenes",
  "gehäuft",
  "gehäufte",
  "gehäufter",
  "gehäuftes",
  "geh",
  "level",
  "heaped",
  "heaping",
]);

/**
 * Fixed "to taste" / "nach Geschmack" phrases. When the parser sees one of
 * these anywhere in the input (case-insensitive), it removes the phrase
 * from the name and appends it to the notes.
 */
const TO_TASTE_PHRASES = [
  "nach geschmack",
  "zum abschmecken",
  "to taste",
];

/**
 * Markers that flag the ingredient as optional. Match anchored at line start
 * (with an optional trailing colon / comma / dash) OR inline as a parenthesised
 * / comma-separated note. Stripping these doesn't add anything to the notes —
 * the isOptional flag on the parsed result carries the meaning.
 */
const OPTIONAL_MARKER_WORDS = [
  "optional",
  "optionally",
  "opt\\.",
  "evtl\\.?",
  "eventuell",
  "wenn vorhanden",
  "bei bedarf",
  "nach belieben",
  "ggf\\.?",
  "if available",
  "if needed",
  "n\\.\\s*B\\.?",
];

const OPTIONAL_LEADING_RE = new RegExp(
  `^\\s*(?:${OPTIONAL_MARKER_WORDS.join("|")})\\s*[:,-]?\\s+`,
  "i",
);
const OPTIONAL_INLINE_PAREN_RE = new RegExp(
  `\\(\\s*(?:${OPTIONAL_MARKER_WORDS.join("|")})\\s*\\)`,
  "i",
);
const OPTIONAL_INLINE_TRAIL_RE = new RegExp(
  `[\\s,–-]+(?:${OPTIONAL_MARKER_WORDS.join("|")})\\s*$`,
  "i",
);
/**
 * The literal word "optional"/"optionally"/"opt." appearing ANYWHERE in the
 * line — even mid-name — sets the flag and is stripped from the text. The
 * user's explicit rule: that word should never end up in the ingredient
 * name or notes.
 */
const OPTIONAL_ANYWHERE_RE =
  /[\s,;()\[\]–-]*\b(?:optional|optionally|opt\.)\b[\s,;()\[\]–-]*/gi;

/**
 * Tokens that, if they appear after a unit token, should still be treated
 * as "tail noise" not as part of the name — e.g. "12-count package" parses
 * "package" as the unit and "12-count" as the size hint via the leading
 * compound-token pre-processor.
 */
const SIZE_UNIT_TOKENS_RE = /^(count|ounce|ounces|oz|inch|inches|gram|grams|g|kg|ml|l|lb|pound|pounds)$/i;

const NUMERIC_TOKEN_RE = /^[\d./,\-–½¼¾⅓⅔⅛⅜⅝⅞]+$/;

function parseSingleNumericToken(t: string): number | null {
  const glyph = /^(\d+)?([½¼¾⅓⅔⅛⅜⅝⅞])$/.exec(t);
  if (glyph) {
    const whole = glyph[1] ? parseInt(glyph[1], 10) : 0;
    return whole + FRACTIONS[glyph[2]];
  }
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) {
    const den = parseInt(frac[2], 10);
    if (den <= 0) return null;
    return parseInt(frac[1], 10) / den;
  }
  const num = /^(\d+(?:[.,]\d+)?|[.,]\d+)$/.exec(t);
  if (num) return parseFloat(num[1].replace(",", "."));
  return null;
}

function evaluateNumericSequence(tokens: string[]): number | null {
  if (tokens.length === 0) return null;
  let total = 0;
  for (const t of tokens) {
    const v = parseSingleNumericToken(t);
    if (v === null) return null;
    total += v;
  }
  return total;
}

type RangeResult = {
  quantity: number;
  /** When the input was a range, the original expression (e.g. "1-2") for
   * inclusion in the notes. Null otherwise. */
  rangeExpression: string | null;
};

/**
 * Consume a quantity from the start of `tokens`. Returns the parsed number
 * (max value when the input is a range) and, when it was a range, the
 * original "lo-hi" expression for the notes.
 */
function consumeQuantity(tokens: string[]): RangeResult | null {
  if (tokens.length === 0) return null;
  // Strip "bis " ("up to") as a leading approximation: "bis 2 EL" → quantity 2,
  // range expr "bis 2".
  let bisPrefix = false;
  if (/^bis$/i.test(tokens[0])) {
    bisPrefix = true;
    tokens.shift();
  }
  if (tokens.length > 0 && APPROX_TOKENS_RE.test(tokens[0])) tokens.shift();
  if (tokens.length === 0) return null;

  // Collect numeric tokens, allowing "+" / "&" between them as additive
  // connectors ("2 + 1/4 cups" / "1 & ½ tsp") and "to" / "bis" as range
  // separators ("4 to 6 cups" / "1 bis 2 EL"). Additive connectors are
  // dropped; range separators are replaced with a dash so the existing
  // range-split path handles them.
  const numericRun: string[] = [];
  while (tokens.length > 0) {
    if (NUMERIC_TOKEN_RE.test(tokens[0])) {
      numericRun.push(tokens.shift()!);
      continue;
    }
    if (
      (tokens[0] === "+" || tokens[0] === "&") &&
      numericRun.length > 0 &&
      tokens.length > 1 &&
      NUMERIC_TOKEN_RE.test(tokens[1])
    ) {
      tokens.shift();
      continue;
    }
    if (
      /^(?:to|bis)$/i.test(tokens[0]) &&
      numericRun.length > 0 &&
      tokens.length > 1 &&
      NUMERIC_TOKEN_RE.test(tokens[1])
    ) {
      tokens.shift();
      numericRun.push("-");
      continue;
    }
    break;
  }
  if (numericRun.length === 0) return null;

  const expr = numericRun.join(" ");
  const parts = expr.split(/\s*[-–]\s*/).filter((p) => p.length > 0);
  if (parts.length === 0) return null;

  const values: number[] = [];
  for (const p of parts) {
    const v = evaluateNumericSequence(p.split(/\s+/).filter(Boolean));
    if (v !== null) values.push(v);
  }
  if (values.length === 0) return null;

  if (values.length === 1 && !bisPrefix) {
    return { quantity: round3(values[0]), rangeExpression: null };
  }
  // Range — take the max, keep the expression for the notes.
  const max = Math.max(...values);
  const rangeExpression = bisPrefix
    ? `bis ${formatRangeNumber(values[values.length - 1])}`
    : values.map(formatRangeNumber).join("-");
  return { quantity: round3(max), rangeExpression };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function formatRangeNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toString().replace(".", ",");
}

const EMOJI_LEAD_RE =
  /^(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{1F600}-\u{1F64F}]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF])\s*/u;

/**
 * Detect when a line is a section header rather than an ingredient. Returns
 * the cleaned header title, or null if the line should be parsed as an
 * ingredient. Heuristics (any of):
 *   - leading 2+ dashes (`"--- For the sauce ---"` → "For the sauce")
 *   - leading emoji
 *   - line ends with ":" ("Für den Teig:" → "Für den Teig")
 *   - line is all-caps (4+ letters), e.g. "FÜR DEN GRANATAPFELGUSS"
 */
export function detectSectionHeader(raw: string): string | null {
  let text = raw.trim();
  if (text.length === 0) return null;

  // Strip surrounding bracket-noise that often wraps section titles in pasted
  // recipes: "[Sauce]" → "Sauce".
  text = text.replace(/^\[|\]$/g, "").trim();

  // "Part 1: Sauce" / "Teil 2: Beilage" — strip the leading "Part N:" prefix
  // and use whatever follows the colon as the section title. When nothing
  // follows, keep the "Part N" label.
  const partMatch = /^(?:part|teil)\s+\d+\s*[:.]?\s*(.*)$/i.exec(text);
  if (partMatch) {
    const rest = partMatch[1].trim();
    return rest.length > 0 ? rest : text.trim();
  }

  if (/^[-–—]{2,}/.test(text) || /[-–—]{2,}$/.test(text)) {
    return text.replace(/^[-–—\s]+|[-–—\s]+$/g, "").trim() || null;
  }

  if (EMOJI_LEAD_RE.test(text)) {
    return text.replace(EMOJI_LEAD_RE, "").trim() || null;
  }

  if (/:\s*$/.test(text)) {
    return text.replace(/:\s*$/, "").trim() || null;
  }

  // All-caps detection: ≥4 letters, no lowercase letters at all. Tolerates
  // umlauts and basic punctuation.
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length >= 4 && letters.every((c) => c === c.toLocaleUpperCase("de"))) {
    return text.trim();
  }

  return null;
}

/**
 * Normalize a string for accent/diacritic-insensitive matching. Used by
 * downstream lookups so "Möhre" matches "Moehre" / "Mohre" / "möhre"
 * (after lower-casing).
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

/** The conjunction "&" and its spelled-out German/English forms, all folded
 *  onto one canonical token so an alias written "Salz und Pfeffer" still
 *  matches a line that uses "Salz & Pfeffer" (or "Salt and Pepper"). */
const CONJUNCTION_TOKENS = new Set(["&", "und", "and"]);

/**
 * Collapse the conjunctions "&", "und" and "and" to a single token. Applied to
 * an already-{@link normalizeForMatch}'d token by every tokenizer (candidate
 * and catalog sides), so the three forms align during matching.
 */
export function canonicalizeMatchToken(normalized: string): string {
  return CONJUNCTION_TOKENS.has(normalized) ? "und" : normalized;
}

/**
 * Tokenize a catalog name (canonical or alias) the way the matcher's catalog
 * side does: split on the same separators as the candidate tokenizer (space,
 * comma, semicolon, slash, hyphen/dashes), then normalise + conjunction-fold
 * each piece. The single source of truth for "what tokens does the matcher
 * see for this name" — used both to build the catalog and to detect aliases
 * that are virtually identical to one another.
 */
export function tokenizeEntryNameForCatalog(name: string): string[] {
  const out: string[] = [];
  for (const piece of name.split(/[\s,;/\-–—]+/u)) {
    if (piece.length === 0) continue;
    const normalized = canonicalizeMatchToken(normalizeForMatch(piece));
    if (normalized.length === 0) continue;
    out.push(normalized);
  }
  return out;
}

/**
 * Collapse a name to the key the matcher would compare on: its catalog tokens
 * joined by a space. Two names with the same key are "virtually identical" —
 * they differ only in case, diacritics, ß, separators (hyphen/slash/comma) or
 * the &/und/and conjunction, so the matcher cannot tell them apart. Used to
 * warn when an alias duplicates the canonical name or another alias.
 */
export function aliasDedupKey(name: string): string {
  return tokenizeEntryNameForCatalog(name).join(" ");
}

/**
 * Pre-process the raw line: strip noise punctuation, brackets-as-notes,
 * to-taste phrases, and amount-at-end inversions.
 *
 * Returns the cleaned text plus any notes captured from the pre-processing.
 */
function preprocess(raw: string): {
  text: string;
  capturedNotes: string[];
  isOptional: boolean;
} {
  // Strip invisible / formatting chars up front: SOFT HYPHEN, ZWSP/ZWNJ/ZWJ,
  // word joiner, BOM. These appear in copy/pasted ingredient text and silently
  // break ingredient-name matching ("Thy­mi­an" vs "Thymian").
  let text = raw
    .replace(/[­​‌‍⁠﻿]/g, "")
    // Strip emoji + symbol-like glyphs that recipe sites use as bullets
    // (▢, ☐, ◯, decorative symbols, recipe-format emojis). The
    // section-header heuristic catches a LEADING emoji separately; here
    // we drop any leftover symbols anywhere in the line so they don't
    // pollute the ingredient name.
    .replace(
      /[▀-▟■-◿☀-⛿✀-➿\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}]/gu,
      "",
    );
  const capturedNotes: string[] = [];
  let isOptional = false;

  // "(...optional...)" — the paren contains the marker. Strip the parens
  // entirely, capture any remaining text from inside as a note, flag
  // optional. Has to run before the generic "optional anywhere" path so
  // we don't leave an orphan ")" behind.
  text = text.replace(
    /\(([^)]*\b(?:optional|optionally|opt\.)\b[^)]*)\)/gi,
    (_match, inner: string) => {
      isOptional = true;
      const cleaned = inner
        .replace(/\b(?:optional|optionally|opt\.)\b/gi, "")
        .replace(/^[\s,;]+|[\s,;]+$/g, "")
        .replace(/[\s,;]+/g, " ")
        .trim();
      if (cleaned.length > 0) capturedNotes.push(cleaned);
      return " ";
    },
  );

  // "optional" / "optionally" / "opt." appearing ANYWHERE flags the row
  // and is stripped from the text. The user's rule: never let those words
  // bleed into the name or notes.
  if (OPTIONAL_ANYWHERE_RE.test(text)) {
    isOptional = true;
    text = text.replace(OPTIONAL_ANYWHERE_RE, " ");
    OPTIONAL_ANYWHERE_RE.lastIndex = 0;
  }
  // Other markers (n. B., evtl., nach Belieben, …) — same strip but they
  // never appear standalone so we still scan all three positions.
  if (OPTIONAL_LEADING_RE.test(text)) {
    isOptional = true;
    text = text.replace(OPTIONAL_LEADING_RE, "");
  }
  if (OPTIONAL_INLINE_PAREN_RE.test(text)) {
    isOptional = true;
    text = text.replace(OPTIONAL_INLINE_PAREN_RE, " ");
  }
  if (OPTIONAL_INLINE_TRAIL_RE.test(text)) {
    isOptional = true;
    text = text.replace(OPTIONAL_INLINE_TRAIL_RE, "");
  }

  // Capture and strip [bracketed text] → notes.
  text = text.replace(/\[([^\]]+)\]/g, (_, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed.length > 0) capturedNotes.push(trimmed);
    return " ";
  });

  // NOTE: "to taste" / "nach Geschmack" phrases are deliberately NOT
  // stripped here anymore. The matcher must see the pristine line (vocab
  // rules apply only on the no-match path — see {@link stripVocabTail});
  // for matched lines the uncovered-tokens→notes fallback routes the
  // phrase to notes. Stripping mid-line text here also stranded
  // surrounding punctuation ("salt- adjust to taste!" left a lone "!").

  // Drop stray "*" anywhere (often used as a formatting marker by recipe
  // sites: "*Hackfleisch", "Salz*").
  text = text.replace(/\*/g, " ");

  // Strip any non-letter / non-digit run from the very start of the line:
  // bullet glyphs like ▢, "+", "&", "·", "•", "~", "*", whitespace,
  // emoji that survived the earlier scrub, dotted-list markers, …
  // Stop as soon as we hit a letter or digit so leading quantities aren't
  // damaged. Preserve a leading "." or "," when it's followed by a digit —
  // that's a decimal like ".5 cup" / ",5 l".
  text = text.replace(/^(?:[^\p{L}\p{N}.,]|[.,](?!\d))+/u, "");
  // Trailing: keep parens / brackets which the bracketed-note logic
  // already handled, just drop punctuation/whitespace (incl. !/? so
  // "salt- adjust to taste!" can't carry the "!" into the name area).
  text = text.replace(/[\s+&·•|.,;:!?]+$/u, "");

  // Strip leading filler conjunctions/articles: "und ", "and ", "the ", and
  // chained-recipe leaders like "plus" / "to" / "or" — those are usually
  // artifacts of how multi-ingredient lines are written.
  text = text.replace(
    /^(?:und|and|the|der|die|das|of|von|vom|or|oder|sowie|plus|to)\s+/i,
    "",
  );

  // Leading "~" (approximation tilde): drop it.
  text = text.replace(/^\s*[~∼]\s*/, "");

  // " / " and " o. " → " or " — keep both alternatives but route them through
  // the existing NOTE_BOUNDARY logic. The negative lookahead skips German
  // "o. Ä." / "o. ä." ("oder Ähnliche/-s" = "or similar"), which is a fixed
  // phrase that belongs in the notes verbatim, not a conjunction.
  text = text
    .replace(/\s+\/\s+/g, " or ")
    .replace(/\s+o\.\s+(?!ä\.)/gi, " or ");

  // Range with repeated unit: "25 g – 50 g" / "100 ml - 200 ml" → "25-50 g"
  // (the duplicated unit is redundant; collapsing it lets the existing range
  // path handle the rest).
  text = text.replace(
    /(\d+(?:[.,]\d+)?)\s+(\p{L}+)\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s+\2\b/gu,
    "$1-$3 $2",
  );

  // "Amount at end" via colon: "Flohsamenschalenpulver: 30 g" → "30 g Flohsamenschalenpulver"
  const colonAmount = /^(.+?):\s*([\d\s./,\-–½¼¾⅓⅔⅛⅜⅝⅞]+(?:\s+\p{L}{1,30})?)\s*$/u.exec(text);
  if (colonAmount) {
    const namePart = colonAmount[1].trim();
    const amountPart = colonAmount[2].trim();
    text = `${amountPart} ${namePart}`;
  }

  // Compound size-unit dash like "12-count", "14-ounce", "1-inch", "4-inch":
  //   - If the next token is a container word (package, can, tin, Dose, …),
  //     the compound describes the container's size — demote to a note and
  //     let the container word become the unit.
  //         "14-ounce can of black beans" → unit "can", note "14 ounce"
  //   - Otherwise the compound IS the quantity + unit — strip just the dash
  //     so the regular parser sees "4 inch stems …" → unit "inch", qty 4.
  const CONTAINER_RE = /(?:package|packages|packet|packets|can|cans|tin|tins|jar|jars|bottle|bottles|tube|tubes|box|boxes|dose|dosen|packung|päckchen|pck|pkg|carton|cartons)/i;
  text = text.replace(
    /(\d+)[-–](count|ounce|ounces|oz|inch|inches|cm|gram|grams|g|kg|ml|l|lb|pound|pounds)\b(\s*)(\S*)/gi,
    (match, num: string, sizeUnit: string, ws: string, next: string) => {
      if (next && CONTAINER_RE.test(next)) {
        capturedNotes.push(`${num} ${sizeUnit}`);
        return `${ws}${next}`;
      }
      return `${num} ${sizeUnit}${ws}${next}`;
    },
  );

  // Parenthesized size like "(28 oz.) can" → drop into notes, keep the main
  // amount/unit/name unaffected.
  text = text.replace(/\(\s*([\d\s./,\-–½¼¾⅓⅔⅛⅜⅝⅞]+\s+\p{L}{1,30}\.?)\s*\)/gu,
    (_match, inner: string) => {
      capturedNotes.push(inner.trim());
      return " ";
    },
  );

  // Collapse whitespace.
  text = text.replace(/\s+/g, " ").trim();
  return { text, capturedNotes, isOptional };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Vocabulary cleanup for the NO-MATCH path only. When a line resolves to a
 * catalog ingredient, the matcher's uncovered-tokens fallback routes phrase
 * words to notes structurally — but when a NEW ingredient is created, the
 * proposed name must not carry usage phrases ("Wasabipulver zum Bestreuen")
 * or fixed to-taste phrases ("Sumac to taste"). This is the single place the
 * TO_TASTE_PHRASES / USAGE_PREFIX_TOKENS / NOTE_BOUNDARY_TOKENS vocabulary
 * still applies; nothing pre-match consults it.
 *
 * Returns the cleaned name plus the extracted note fragments (in source
 * order: boundary tail last). Pure string function — no lookups.
 */
export function stripVocabTail(name: string): { name: string; notes: string[] } {
  const notes: string[] = [];
  let text = name;
  // Fixed "to taste" / "nach Geschmack" phrases anywhere in the name.
  for (const phrase of TO_TASTE_PHRASES) {
    const re = new RegExp(`(?:[-–—,]\\s*)?\\b${escapeRegExp(phrase)}\\b`, "gi");
    if (re.test(text)) {
      notes.push(phrase);
      text = text.replace(re, " ");
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  // Usage / annotation boundary: everything from the first "zum"/"für" or
  // "z.B."/"bzw." token onward is a note about how the ingredient is used.
  // Guards mirror the old name-area walk: at least one name token must
  // precede the split, and a dash-compound ("Weizen- oder Dinkelmehl")
  // keeps its conjunction in the name.
  // Drop tokens a phrase removal may have stranded (pure punctuation),
  // mirroring tokenize()'s standalone-noise filter.
  const tokens = text
    .split(/\s+/)
    .filter((t) => t.length > 0 && !/^[-–—!?]+$/.test(t));
  let split = -1;
  for (let i = 1; i < tokens.length; i++) {
    const lower = tokens[i].toLowerCase();
    if (USAGE_PREFIX_TOKENS.has(lower)) {
      split = i;
      break;
    }
    if (NOTE_BOUNDARY_TOKENS.has(lower)) {
      const prev = tokens[i - 1];
      if (prev.endsWith("-") || prev.endsWith("–")) continue;
      split = i;
      break;
    }
  }
  if (split > 0) {
    notes.push(tokens.slice(split).join(" "));
    text = tokens.slice(0, split).join(" ");
  } else {
    text = tokens.join(" ");
  }
  return { name: text, notes };
}

function normalize(s: string): string {
  return (
    s
      .replace(/\s+/g, " ")
      // Spaced decimal commas/dots — Familywall sometimes serves "0, 5" or
      // "1 . 5". Collapse to "0,5" / "1.5" before tokenising so the numeric
      // matchers see them as one token.
      .replace(/(\d)\s+([.,])\s*(\d)/g, "$1$2$3")
      .replace(/(\d)([.,])\s+(\d)/g, "$1$2$3")
      // Pseudo-pluralization markers in scraped German recipes:
      //   "Tomate(n)" → "Tomate", "Zehe(n)" → "Zehe", "Dose/n" → "Dose"
      .replace(/([\p{L}]+)\((\p{L}{1,3})\)/gu, "$1")
      .replace(/([\p{L}]+)\/\p{L}{1,3}\b/gu, "$1")
      // "Weizen- oder Dinkelmehl" — dash followed by alternative-word: glue
      // the parts together so the splitter / boundary logic doesn't split it.
      // We preserve the dash to keep it visually faithful.
      .replace(
        /([\p{L}]+)-\s+(oder|or|bzw\.?|alternativ|alternatively)\s+/giu,
        "$1- $2 ",
      )
      .trim()
  );
}

function tokenize(input: string): string[] {
  const padded = input
    .replace(/(?<!\d),|,(?!\d)/g, " , ")
    .replace(/([;()])/g, " $1 ")
    // Inch symbol attached to a number: 1" → 1 "
    .replace(/(\d)"/g, '$1 "')
    .replace(/(\d)([½¼¾⅓⅔⅛⅜⅝⅞])/g, "$1 $2")
    .replace(/(\d)([a-zA-ZäöüÄÖÜß])/g, "$1 $2")
    .replace(/([½¼¾⅓⅔⅛⅜⅝⅞])([a-zA-ZäöüÄÖÜß])/g, "$1 $2")
    // Slash between two letters splits into separate tokens
    // ("kleine/mittlere Paprika" → "kleine mittlere Paprika"). The size-
    // modifier loop can then strip each adjective independently. Numeric
    // fractions ("1/2", "1/4") survive because both sides need to be
    // letters. Short suffix shorthands ("Dose/n", "Tomate(n)/T/n") are
    // already collapsed in `preprocess` before this point, so they don't
    // reach the tokenizer.
    .replace(/(\p{L})\/(\p{L})/gu, "$1 $2")
    // A dash adjacent to whitespace acts as a note separator
    // ("bell pepper- thinly sliced" → pad to a standalone "-" token). Don't
    // touch dashes inside compounds where neither side has whitespace
    // ("Persian-style", "Weizen-Vollkornmehl"). Also skip dash-compound +
    // conjunction ("Weizen- oder Dinkelmehl"): when the word AFTER the
    // whitespace is "oder"/"or"/"und"/"and"/"bzw"/"alternativ", keep the
    // dash glued to the preceding word so the parser treats the whole
    // span as one ingredient name.
    .replace(
      /([\p{L}\)\]])([-–])(\s+)(?!(?:oder|or|und|and|bzw\.?|alternativ|alternatively)\b)/gu,
      "$1 $2 $3",
    )
    .replace(/(\s)([-–])([\p{L}\(])/gu, "$1$2 $3");
  // Drop standalone dash / punctuation tokens entirely. Dashes show up when
  // the source had whitespace around one ("Bio - Honig", "Salz – nach
  // Geschmack"); other sentence punctuation gets stranded when a phrase
  // capture removes the words around it ("salt- adjust to taste!" → the "!"
  // stays behind once "to taste" moves to notes — it once even accrued into
  // a catalog alias "salt adjust !"). None of them carry information the
  // downstream parser needs:
  //   - "to taste" / "nach Geschmack" follow-ups are already captured by
  //     {@link TO_TASTE_PHRASES} in preprocess (which strips the leading
  //     dash with them);
  //   - intra-name compounds ("Bio - Honig") should collapse to a single
  //     name "Bio Honig" rather than splitting "Bio" off as its own
  //     ingredient with the noun shoved into notes.
  // We keep dashes that stay glued inside a multi-char token ("Bio-Honig",
  // "Weizen-Vollkornmehl") — those are part of the name — and deliberately
  // leave structural tokens alone: "," / ";" / ":" drive the comma-tail →
  // notes split downstream, "&" joins names ("Mac & Cheese"), "+" adds
  // quantities. Only pure exclamation/question marks are noise.
  return padded
    .split(/\s+/)
    .filter((t) => t.length > 0 && !/^[-–—!?]+$/.test(t));
}

/**
 * Drop leading filler tokens that snuck through the preprocess regex (they
 * may appear after a quantity-or-unit prefix has been consumed too).
 */
function dropLeadingFiller(tokens: string[]): void {
  while (tokens.length > 0) {
    const lower = tokens[0].toLowerCase().replace(/[.,;]$/, "");
    if (NAME_FILLER_TOKENS.has(lower)) {
      tokens.shift();
    } else {
      break;
    }
  }
}

export function parseIngredientString(
  raw: string,
  knownUnitTokens: ReadonlySet<string>,
): ParsedIngredient {
  const { text: preprocessed, capturedNotes, isOptional } = preprocess(raw);
  const cleaned = normalize(preprocessed);
  if (cleaned.length === 0) {
    const notes =
      capturedNotes.length > 0 ? capturedNotes.join(", ") : null;
    return {
      quantity: null,
      unitName: null,
      name: "",
      commaTailText: "",
      notes,
      isOptional,
      altWithPrepStripped: null,
      leadingNotes: [],
      nameAreaNotes: [],
      postCommaNotes: "",
      trailingNotes: [...capturedNotes],
      nameTokenCount: 0,
    };
  }
  const tokens = tokenize(cleaned);

  dropLeadingFiller(tokens);

  // Leading preparation nouns — "Saft einer halben Zitrone", "Abrieb einer
  // Bio-Orange", "juice of half a lemon". We only treat the noun as
  // preparatory when the next token is an article / preposition; otherwise
  // it might be a real ingredient name on its own ("Saft" the boxed juice).
  if (
    tokens.length >= 2 &&
    PREP_LEADING_NOUNS.has(tokens[0].toLowerCase()) &&
    PREP_FOLLOWUP_TOKENS.has(tokens[1].toLowerCase().replace(/[.,;]$/, ""))
  ) {
    capturedNotes.push(tokens.shift()!);
    // Re-strip filler so the next stage sees the actual quantity / unit
    // token, not "von" / "einer".
    dropLeadingFiller(tokens);
  }

  // Pre-quantity size modifiers — "Heaping 1 teaspoon", "Scant ½ cup",
  // "Gehäuft 1 EL". The same modifier can also sit between quantity and
  // unit ("1 heaping teaspoon"), which the post-quantity loop below
  // handles. Both paths fill the same `sizeModifiers` array.
  const sizeModifiers: string[] = [];
  while (tokens.length > 0) {
    const raw = tokens[0].toLowerCase();
    const lower = raw.replace(/\.$/, "");
    // Some tokens live in both sets — "gr" is German shorthand for "groß"
    // (size modifier) AND for "Gramm" (mass unit). When a unit reading is
    // possible, prefer it: "150 gr. Joghurt" should resolve to grams, not
    // "groß" + Joghurt. The unit detector below will re-check the same
    // token shapes (`raw`, `lower`, `lower + "."`).
    const isUnit =
      knownUnitTokens.has(raw) ||
      knownUnitTokens.has(lower) ||
      knownUnitTokens.has(`${lower}.`);
    if (SIZE_MODIFIER_TOKENS.has(lower) && !isUnit) {
      sizeModifiers.push(tokens.shift()!);
    } else {
      break;
    }
  }

  // Quantity may be a text amount ("Eine Prise", "a pinch"), a vague amount
  // ("Etwas Salz"), a numeric range, or a single number.
  let quantity: number | null = null;
  const rangeNotes: string[] = [];

  if (tokens.length > 0) {
    const firstLower = tokens[0].toLowerCase();
    if (TEXT_AMOUNT_VAGUE.has(firstLower)) {
      capturedNotes.push(tokens[0]);
      tokens.shift();
      quantity = null;
    } else if (TEXT_AMOUNT_ONE.has(firstLower)) {
      tokens.shift();
      quantity = 1;
      // "ein halber TL", "eine halbe Tasse", "ein viertel TL" — indefinite
      // article + fraction word together still mean the fraction, not 1.
      // Peel the follow-up so the downstream unit detector sees the real
      // unit token next.
      if (tokens.length > 0) {
        const nextLower = tokens[0].toLowerCase();
        if (TEXT_AMOUNT_HALF.has(nextLower)) {
          tokens.shift();
          quantity = 0.5;
        } else if (TEXT_AMOUNT_QUARTER.has(nextLower)) {
          tokens.shift();
          quantity = 0.25;
        }
      }
    } else if (TEXT_AMOUNT_HALF.has(firstLower)) {
      tokens.shift();
      quantity = 0.5;
      // "half a teaspoon" — drop the trailing article so the unit detector
      // sees the unit token next.
      if (tokens.length > 0 && TEXT_AMOUNT_ONE.has(tokens[0].toLowerCase())) {
        tokens.shift();
      }
    } else if (TEXT_AMOUNT_QUARTER.has(firstLower)) {
      tokens.shift();
      quantity = 0.25;
      if (tokens.length > 0 && TEXT_AMOUNT_ONE.has(tokens[0].toLowerCase())) {
        tokens.shift();
      }
    } else {
      const range = consumeQuantity(tokens);
      if (range) {
        quantity = range.quantity;
        if (range.rangeExpression) rangeNotes.push(range.rangeExpression);
      }
    }
  }

  // Post-quantity size modifiers ("1 kl. Dose", "2 große Eier") — these
  // sit between the quantity and the unit. Both paths share `sizeModifiers`.
  while (tokens.length > 0) {
    const raw = tokens[0].toLowerCase();
    const lower = raw.replace(/\.$/, "");
    // Some tokens live in both sets — "gr" is German shorthand for "groß"
    // (size modifier) AND for "Gramm" (mass unit). When a unit reading is
    // possible, prefer it: "150 gr. Joghurt" should resolve to grams, not
    // "groß" + Joghurt. The unit detector below will re-check the same
    // token shapes (`raw`, `lower`, `lower + "."`).
    const isUnit =
      knownUnitTokens.has(raw) ||
      knownUnitTokens.has(lower) ||
      knownUnitTokens.has(`${lower}.`);
    if (SIZE_MODIFIER_TOKENS.has(lower) && !isUnit) {
      sizeModifiers.push(tokens.shift()!);
    } else {
      break;
    }
  }

  // Optional unit: matched against the DB-derived token set.
  let unitName: string | null = null;
  if (tokens.length > 0) {
    const candidate = tokens[0];
    const lower = candidate.toLowerCase();
    const stripped = lower.replace(/\.$/, "");
    if (
      knownUnitTokens.has(lower) ||
      knownUnitTokens.has(stripped) ||
      knownUnitTokens.has(`${stripped}.`)
    ) {
      unitName = candidate.replace(/\.$/, "");
      tokens.shift();
      // Fallback: unit present but no amount → default to 1.
      if (quantity === null) quantity = 1;
    }
  }

  // Drop a leading filler word between unit and name ("of", "von", "and").
  dropLeadingFiller(tokens);

  // Detect a leading "usage" phrase ("zum Bestreuen", "for drizzling") that
  // shouldn't be part of the name.
  const nameTokens: string[] = [];
  const noteTokens: string[] = [];
  // Tokens that landed in noteTokens specifically because of a TRUE
  // comma at name-area depth 0. Used downstream as `commaTailText` so the
  // matcher can fold "Paprikapulver, rosenscharf" back to a single
  // "Paprikapulver rosenscharf" alias hit — without also grabbing
  // parens-captured or USAGE_PREFIX content.
  const commaTailTokens: string[] = [];
  // Parens that appear INSIDE the name area (before any top-level comma) are
  // recorded positionally so the matched path can slot them back between the
  // right name tokens. Parens after the comma stay in `noteTokens`.
  const nameAreaNotes: { afterText: string; text: string }[] = [];
  let parenBuf: string[] = [];
  let parenInNameArea = false;
  let inNotes = false;
  let inCommaTail = false;
  let parenDepth = 0;
  for (const t of tokens) {
    if (t === "(") {
      if (parenDepth === 0) {
        parenInNameArea = !inNotes;
        // When the parens block follows a non-empty stretch of notes,
        // emit a comma so the reader sees them as separate phrases:
        //   "Paprikaschote, rote (fein gehackt)" → notes "rote, fein gehackt"
        // instead of "rote fein gehackt".
        if (!parenInNameArea && inNotes && noteTokens.length > 0) {
          noteTokens.push(",");
        }
      }
      parenDepth += 1;
      // Entering a parens block ends any active comma-tail run.
      inCommaTail = false;
      continue;
    }
    if (t === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      if (parenDepth === 0 && parenInNameArea) {
        const txt = parenBuf
          .join(" ")
          .replace(/[()]/g, "")
          .replace(/\s+/g, " ")
          // Tidy spaces around an internal comma/semicolon ("Rolle , TK" →
          // "Rolle, TK"), matching the noteBody normalization.
          .replace(/\s*([,;])\s*/g, "$1 ")
          .replace(/^[\s,;]+|[\s,;]+$/g, "")
          .trim();
        if (txt.length > 0) {
          nameAreaNotes.push({ afterText: nameTokens.join(" "), text: txt });
        }
        parenBuf = [];
        parenInNameArea = false;
      }
      continue;
    }
    if (parenDepth > 0) {
      if (parenInNameArea) parenBuf.push(t);
      else noteTokens.push(t);
      continue;
    }
    const lower = t.toLowerCase();
    if (!inNotes && t === ",") {
      inNotes = true;
      inCommaTail = true;
      // A note fragment already exists (e.g. a paren block that appeared
      // before the name, "(225g) large shrimp, …") — separate it from the
      // upcoming comma-tail with a comma so the two stay distinct fragments.
      if (noteTokens.length > 0) noteTokens.push(",");
      continue;
    }
    if (t === "," || t === ";") {
      if (inNotes) noteTokens.push(",");
      // Another comma ends the in-comma-tail run, even though notes mode
      // stays on.
      inCommaTail = false;
      continue;
    }
    // NOTE: the USAGE_PREFIX_TOKENS ("zum", "für", …) and
    // NOTE_BOUNDARY_TOKENS ("z.B.", "bzw.", …) name→notes splits used to
    // live here — removed on purpose. The matcher must see the pristine
    // name area (vocab rules apply only on the no-match path, see
    // {@link stripVocabTail}); a matched line routes those tokens to notes
    // via the uncovered-tokens fallback, and ranking ties like
    // "Öl z.B. Olivenöl" are settled by the matcher's position tiebreak.
    if (inNotes) {
      noteTokens.push(t);
      if (inCommaTail) commaTailTokens.push(t);
    } else {
      nameTokens.push(t);
    }
  }

  // Tidy: trim trailing filler from the name area.
  while (
    nameTokens.length > 0 &&
    NAME_FILLER_TOKENS.has(
      nameTokens[nameTokens.length - 1].toLowerCase().replace(/[.,;]$/, ""),
    )
  ) {
    nameTokens.pop();
  }
  // Same at the start, in case all previous strips missed anything.
  while (
    nameTokens.length > 0 &&
    NAME_FILLER_TOKENS.has(nameTokens[0].toLowerCase().replace(/[.,;]$/, ""))
  ) {
    nameTokens.shift();
  }
  // Drop a trailing bare unit-noise token if it managed to land in the name
  // (e.g. lonely "package" left over after the "(28 oz.) can" path).
  while (
    nameTokens.length > 1 &&
    SIZE_UNIT_TOKENS_RE.test(nameTokens[nameTokens.length - 1])
  ) {
    nameTokens.pop();
  }

  // Trailing-unit fallback: when we didn't catch a unit after the quantity
  // ("1 garlic clove") but the last name token IS a known unit, peel it
  // off. This handles English-style "qty NAME UNIT" alongside the more
  // common "qty UNIT NAME" the main loop already covers.
  if (
    unitName === null &&
    nameTokens.length >= 2 &&
    quantity !== null
  ) {
    const lastToken = nameTokens[nameTokens.length - 1];
    const lower = lastToken.toLowerCase();
    const stripped = lower.replace(/\.$/, "");
    if (
      knownUnitTokens.has(lower) ||
      knownUnitTokens.has(stripped) ||
      knownUnitTokens.has(`${stripped}.`)
    ) {
      unitName = lastToken.replace(/\.$/, "");
      nameTokens.pop();
    }
  }

  // Secondary "N UNIT" runs inside the name area — these come from
  // parallel measurement writeups like "½ cup 1 stick unsalted butter"
  // (where "½ cup" is consumed as the real quantity+unit and "1 stick"
  // is a parenthetical alternative the user dropped the parens around)
  // or "1½ tsp. plus ¼ cup cornstarch" (where "plus" is filler-stripped
  // but the secondary "¼ cup" is left behind). Walk the name tokens and
  // peel any "number UNIT" run, pushing it to notes verbatim. A number with
  // NO unit attached stays in the name — it's product identity, not a
  // measurement ("Weizenmehl Typ 405" must keep "405" so the matcher can
  // align it against the full catalog alias).
  const secondaryAmounts: string[] = [];
  {
    const kept: string[] = [];
    for (let i = 0; i < nameTokens.length; ) {
      const t = nameTokens[i];
      if (NUMERIC_TOKEN_RE.test(t)) {
        const run = [t];
        let j = i + 1;
        // Consume any trailing fraction glyph attached to the run
        // ("1 ½" tokens) plus the unit-like token that qualifies the run
        // as a secondary measurement.
        if (j < nameTokens.length && NUMERIC_TOKEN_RE.test(nameTokens[j])) {
          run.push(nameTokens[j]);
          j += 1;
        }
        let hasUnit = false;
        if (j < nameTokens.length) {
          const next = nameTokens[j];
          const lower = next.toLowerCase();
          const stripped = lower.replace(/\.$/, "");
          hasUnit =
            knownUnitTokens.has(lower) ||
            knownUnitTokens.has(stripped) ||
            knownUnitTokens.has(`${stripped}.`) ||
            SIZE_UNIT_TOKENS_RE.test(next);
          if (hasUnit) {
            run.push(next);
            j += 1;
          }
        }
        if (hasUnit) secondaryAmounts.push(run.join(" "));
        else kept.push(...run);
        i = j;
      } else {
        kept.push(t);
        i += 1;
      }
    }
    nameTokens.splice(0, nameTokens.length, ...kept);
  }

  const name = nameTokens
    .join(" ")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Just the post-comma name-area portion. Parens-captured and USAGE_PREFIX-
  // triggered tokens land in noteTokens but not here, so the matcher can
  // safely consume `commaTailText` without re-grabbing user-marked notes.
  const commaTailText = commaTailTokens
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;]+|[\s,;]+$/g, "")
    .trim();
  const noteBody =
    noteTokens
      .join(" ")
      .replace(/[()]/g, "")
      .replace(/\s+/g, " ")
      // Tidy spaces around comma/semicolon separators that came from the
      // paren-boundary commas or the ", " inside the source line.
      .replace(/\s*([,;])\s*/g, "$1 ")
      .replace(/^[\s,;]+|[\s,;]+$/g, "")
      .trim();
  const sizeNote = sizeModifiers.join(" ").trim();
  // Source-ordered note fragments. `leadingNotes` sit with the quantity at
  // the front; `nameAreaNotes` are in-line parens at their name-area position;
  // `noteBody` is the post-comma tail; `capturedNotes` (preprocess-hoisted
  // brackets / "to taste") trail. The matched path re-interleaves these with
  // the name-area descriptors the matcher didn't take (see computeNameAndNotes);
  // here we join them in occurrence order for the new-ingredient / fallback
  // case. e.g. "1/2 pound (225g) large shrimp, peeled and deveined" →
  // "large, 225 g, peeled and deveined".
  const leadingNotes = [sizeNote, ...rangeNotes, ...secondaryAmounts]
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const trailingNotes = capturedNotes
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const notes =
    [
      ...leadingNotes,
      ...nameAreaNotes.map((n) => n.text),
      noteBody,
      ...trailingNotes,
    ]
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join(", ") || null;

  // Produce the prep-stripped alternative. Peel PREP_LEADING_TOKENS off
  // BOTH ends of the name area; the stripped tokens become extra notes.
  // Trailing peel catches "1 large onion chopped" / "1 onion finely chopped"
  // where the prep follows the noun with no comma to separate it. Only
  // emit an alt if we'd have a non-empty name left AND we did strip
  // something — otherwise return null to signal "no choice".
  const leadingStripped: string[] = [];
  let firstKept = 0;
  while (
    firstKept < nameTokens.length &&
    isPrepLeadingToken(nameTokens[firstKept])
  ) {
    leadingStripped.push(nameTokens[firstKept]);
    firstKept += 1;
  }
  const trailingStripped: string[] = [];
  let lastKept = nameTokens.length;
  while (
    lastKept > firstKept &&
    isPrepLeadingToken(nameTokens[lastKept - 1])
  ) {
    // Build the trailing list in source order so the notes read naturally.
    trailingStripped.unshift(nameTokens[lastKept - 1]);
    lastKept -= 1;
  }
  let altWithPrepStripped: ParsedIngredient["altWithPrepStripped"] = null;
  const totalStripped = leadingStripped.length + trailingStripped.length;
  if (totalStripped > 0 && firstKept < lastKept) {
    const altName = nameTokens
      .slice(firstKept, lastKept)
      .join(" ")
      .replace(/[()]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const stripNote = [...leadingStripped, ...trailingStripped].join(" ");
    const altNotes =
      [
        sizeNote,
        ...rangeNotes,
        ...secondaryAmounts,
        ...nameAreaNotes.map((n) => n.text),
        stripNote,
        noteBody,
        ...capturedNotes,
      ]
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .join(", ") || null;
    altWithPrepStripped = { name: altName, notes: altNotes };
  }

  return {
    quantity,
    unitName,
    name,
    commaTailText,
    notes,
    isOptional,
    altWithPrepStripped,
    leadingNotes,
    nameAreaNotes,
    postCommaNotes: noteBody,
    trailingNotes,
    nameTokenCount: nameTokens.length,
  };
}

/**
 * Split a raw line into one OR MORE ingredient strings by separating on
 * "und"/"and"/"&" — but only when they look like list separators, not when
 * they continue a dash-compounded name ("Weizen- oder Dinkelmehl").
 *
 * Returns the original line as a single-element array when no split applies,
 * so the existing single-output parser is the no-op path.
 */
/**
 * Cooking-prep words that, when they appear at the very front of the name
 * area, can be peeled off into the notes. Used to produce the alternative
 * parse — the caller picks between the full and stripped forms based on
 * container presence and existing ingredient matches.
 *
 * Matched case-insensitively. Includes past participles (English -ed forms,
 * German -t / -en forms) plus their typical adverbs. Excludes ambiguous
 * descriptors like "fresh"/"frisch"/"ripe"/"reif"/"raw" — those can be
 * either a prep instruction or part of the canonical name, so we leave
 * them in.
 */
/**
 * Match a token against PREP_LEADING_TOKENS, accounting for German adjective
 * inflection. "gehackte/gehackter/gehacktes/gehackten" all reduce to the
 * base "gehackt" before lookup, so the set only needs one entry per stem.
 * False positives are unlikely because the base forms are participles /
 * adverbs that don't overlap with ingredient names.
 */
export function isPrepLeadingToken(token: string): boolean {
  const lower = token.toLowerCase();
  if (PREP_LEADING_TOKENS.has(lower)) return true;
  // Size modifiers ("klein", "groß", "mittelgroß", …) qualify too when they
  // land in the trailing position of the name area — e.g. "Tomaten klein
  // gehackt" → strip "gehackt" then "klein", leaving "Tomaten" as the
  // identity. Without this, "klein" survives and pushes the cleaned name
  // ("Tomaten klein") out of matcher range.
  if (SIZE_MODIFIER_TOKENS.has(lower)) return true;
  // Try stripping the typical German declined-adjective suffixes.
  for (const suffix of ["er", "en", "es", "em", "e"]) {
    if (lower.endsWith(suffix)) {
      const stem = lower.slice(0, -suffix.length);
      if (PREP_LEADING_TOKENS.has(stem) || SIZE_MODIFIER_TOKENS.has(stem))
        return true;
    }
  }
  return false;
}

export const PREP_LEADING_TOKENS = new Set([
  // English past participles
  "chopped",
  "sliced",
  "diced",
  "grated",
  "minced",
  "halved",
  "quartered",
  "peeled",
  "rinsed",
  "drained",
  "cooked",
  "baked",
  "mixed",
  "crushed",
  "melted",
  "softened",
  "whisked",
  "beaten",
  "shredded",
  "ground",
  "soaked",
  "rolled",
  "patted",
  "deveined",
  "seeded",
  "stemmed",
  "trimmed",
  "crumbled",
  // English adverbs that pair with prep verbs
  "finely",
  "coarsely",
  "thinly",
  "thickly",
  "roughly",
  "lightly",
  "freshly",
  "well",
  // German past participles
  "gewürfelt",
  "gehackt",
  "geschnitten",
  "püriert",
  "gerieben",
  "geschält",
  "gewaschen",
  "erhitzt",
  "geknetet",
  "gemischt",
  "geraspelt",
  "gedünstet",
  "angedünstet",
  "angeschwitzt",
  "angeröstet",
  "angebraten",
  "geröstet",
  "angestoßen",
  "verschlagen",
  "verquirlt",
  "abgetropft",
  "gekocht",
  "blanchiert",
  // "gepresst(e/r/n)" — describes a prep action (pressing garlic, citrus, …)
  // not a product identity. "gepresste Knoblauchzehen" → name
  // "Knoblauchzehen" (matches the alias → sub-unit Zehe), notes "gepresst".
  "gepresst",
  // NOTE: "gemahlen" is NOT in this set — ground spices are a distinct
  // product on the shelf and the descriptor needs to stay in the name.
  // Same goes for "frozen" / "TK" / "getrocknet" — see
  // feedback_prep_vs_identity_tokens.md for the rule.
  // German adverbs
  "fein",
  "grob",
  "frisch",
  "glasig",
  "leicht",
  "kurz",
  "knapp",
  // Temperature / state-at-use adverbs — describe how you USE the ingredient,
  // not what to buy ("120 ml heißes Wasser" → boil water at use time, you
  // still buy plain Wasser). Inflections (heißes/heiße/heißer/heißen,
  // kalter/kaltes/kalten, …) are picked up by isPrepLeadingToken's suffix
  // stripper.
  "heiß",
  "kalt",
  "eiskalt",
  "warm",
  "lauwarm",
  "lukewarm",
  "hot",
  "cold",
  "ice-cold",
  "icy",
]);

export type SplitConjunctionsOptions = {
  /**
   * Lowercased tokens of units flagged as containers in the DB (Dose, can,
   * Glas, jar, Tube, Flasche, Karton, Schachtel, Packung, …). When any of
   * these appears in the line, splitting is suppressed — the whole line is
   * one product.
   */
  containerTokens?: ReadonlySet<string>;
  /**
   * Lowercased known ingredient names + aliases. When any of these appears
   * as a substring of the line that *spans* a conjunction position,
   * splitting at that position is suppressed — the user already has a
   * canonical ingredient that crosses the conjunction.
   */
  knownIngredients?: ReadonlySet<string>;
};

/**
 * Color/variety adjectives that don't stand alone as ingredients. When a
 * conjunction sits between two of these ("yellow and red grape tomatoes"),
 * the two sides describe the same noun and must not be split apart —
 * otherwise we'd produce a phantom "yellow" ingredient. Inflection-aware
 * lookup catches German declined forms ("gelbe"/"gelber"/"gelben" → "gelb").
 */
const COLOR_ADJECTIVE_BASES = new Set([
  // English
  "yellow",
  "red",
  "green",
  "blue",
  "white",
  "black",
  "purple",
  "pink",
  "brown",
  "gray",
  "grey",
  // German bases — declined forms collapse via the suffix stripper below.
  "gelb",
  "rot",
  "grün",
  "blau",
  "weiß",
  "weiss",
  "schwarz",
  "lila",
  "rosa",
  "braun",
  "grau",
]);

function isColorAdjective(token: string): boolean {
  const lower = token.toLowerCase();
  if (COLOR_ADJECTIVE_BASES.has(lower)) return true;
  for (const suffix of ["er", "en", "es", "em", "e"]) {
    if (lower.endsWith(suffix)) {
      const stem = lower.slice(0, -suffix.length);
      if (COLOR_ADJECTIVE_BASES.has(stem)) return true;
    }
  }
  return false;
}

/**
 * Single-token names that should never become ingredient rows on their own —
 * descriptors / colors / preparation states that only make sense modifying a
 * head noun. Truncated source lines like "8 frische" or "1 cup fresh" leak
 * these as standalone names. With the first-wins alternatives mode the
 * importer drops such rows entirely (the user-facing recipe loses a
 * meaningless fragment, no garbage canonical gets created).
 *
 * Compared case-insensitively against the cleaned parsed name.
 */
/**
 * Usage-target nouns that, when they appear as standalone post-split
 * fragments, are use-locations rather than ingredients. Familywall
 * commonly writes "etwas Mehl für die Form und Arbeitsfläche" — the
 * conjunction splitter then yields a bare "Arbeitsfläche" piece that has
 * no business being a recipe ingredient. Same with "für die Pfanne",
 * "for the bowl", etc. The familywall importer drops these post-split
 * fragments.
 */
const STANDALONE_USAGE_TARGETS = new Set<string>([
  "arbeitsfläche",
  "form",
  "pfanne",
  "topf",
  "schüssel",
  "backblech",
  "auflaufform",
  "kuchenform",
  "backform",
  "pan",
  "bowl",
  "tray",
  "sheet",
]);

const STANDALONE_DESCRIPTOR_NAMES = new Set<string>([
  // German descriptors (with inflections)
  "frisch", "frische", "frischer", "frisches", "frischen", "frischem",
  "rot", "rote", "roter", "rotes", "roten", "rotem",
  "grün", "grüne", "grüner", "grünes", "grünen", "grünem",
  "gelb", "gelbe", "gelber", "gelbes", "gelben", "gelbem",
  "weiß", "weiße", "weißer", "weißes", "weißen", "weißem",
  "schwarz", "schwarze", "schwarzer", "schwarzes", "schwarzen", "schwarzem",
  "braun", "braune", "brauner", "braunes", "braunen", "braunem",
  "klein", "kleine", "kleiner", "kleines", "kleinen", "kleinem",
  "groß", "große", "großer", "großes", "großen", "großem", "gross", "grosse",
  "getrocknet", "getrocknete", "getrockneter", "getrocknetes",
  "getrockneten", "getrocknetem",
  "trocken", "trockene", "trockener", "trockenes", "trockenen",
  "geschält", "geschälte", "geschälter", "geschältes", "geschälten",
  "gehackt", "gehackte", "gehackter", "gehacktes", "gehackten",
  "reif", "reife", "reifer", "reifes", "reifen",
  // English descriptors
  "fresh", "dried", "peeled", "chopped", "diced", "sliced", "minced",
  "red", "green", "yellow", "white", "black", "blue",
  "small", "large", "medium", "big",
  "light", "dark", "raw", "cooked", "uncooked", "steamed",
  "firm", "block", "crushed", "grains", "store-bought",
  // Misc tokens that show up in truncated lines
  "zest", "leaves", "peel",
]);

/**
 * Returns true when every token in `name` is a descriptor / color / prep
 * state — no head noun anchors the phrase. Catches both single-token cases
 * ("frische", "fresh") and multi-token combinations of pure descriptors
 * ("trockene grüne", "dried green", "package firm"). Also catches
 * standalone usage-target nouns (Arbeitsfläche, Form, Pfanne) that get
 * stranded by the conjunction splitter (e.g. "Mehl für die Form und
 * Arbeitsfläche" → ["Mehl für die Form", "Arbeitsfläche"]).
 */
export function isStandaloneDescriptor(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return true;
  const tokens = trimmed.toLowerCase().split(/\s+/);
  if (tokens.length === 1 && STANDALONE_USAGE_TARGETS.has(tokens[0])) return true;
  for (const t of tokens) {
    if (!STANDALONE_DESCRIPTOR_NAMES.has(t)) return false;
  }
  return true;
}

/**
 * Pre-process a raw line BEFORE `splitConjunctions`:
 *
 * 1. **Adjacent ingredients without a conjunction.** Recipes commonly write
 *    "1 Prise Salz Pfeffer" (no `und`) when they mean salt-and-pepper.
 *    Inject `und` between the well-known adjacent pair so the standard
 *    conjunction splitter then yields two rows.
 *
 * 2. **Dash-prefix shared-suffix `X- oder Y[suffix]`.** Expand
 *    "Weizen- oder Dinkelmehl" → "Weizenmehl oder Dinkelmehl" by finding
 *    the longest tail of `Y[suffix]` such that `stem + tail` matches a
 *    known ingredient (catalog entries via `knownIngredientKeys`). Falls
 *    back to just stitching the dash off. The downstream " oder " rule in
 *    {@link expandIngredientLine} then emits Weizenmehl (primary) +
 *    Dinkelmehl (alternative).
 *
 * The check against `knownIngredientKeys` uses {@link normalizeForMatch}
 * so the keys (which are stored both as lowercased and as diacritic-
 * stripped forms) align with the candidate compound's normalized form.
 */
export function preprocessAlternatives(
  raw: string,
  knownIngredientKeys: Set<string>,
): string {
  let line = raw;

  // 1. Inject missing conjunction between adjacent well-known pairs.
  line = line.replace(/\b(Salz)\s+(Pfeffer)\b/gi, "$1 und $2");
  line = line.replace(/\b(salt)\s+(pepper)\b/gi, "$1 and $2");

  // 2. Dash-prefix shared-suffix conjunction: "Weizen- oder Dinkelmehl"
  //    → "Weizenmehl oder Dinkelmehl" by adopting the longest catalog-known
  //    tail of `second` onto `stem`. The expansion's " oder " rule then
  //    emits Weizenmehl as primary + Dinkelmehl as alternative.
  line = line.replace(
    /([A-Za-zÄÖÜäöüß]+)-\s+(?:oder|or)\s+([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]+)/g,
    (_full, stem: string, second: string) => {
      for (
        let len = Math.min(second.length - 1, 14);
        len >= 2;
        len--
      ) {
        const tail = second.slice(-len);
        const candidate = stem + tail;
        if (knownIngredientKeys.has(normalizeForMatch(candidate))) {
          return `${candidate} oder ${second}`;
        }
      }
      // No catalog hit — drop the dash, keep both parts. The expansion's
      // " oder " rule then treats them as primary + alternative.
      return `${stem} oder ${second}`;
    },
  );

  return line;
}

export function splitConjunctions(
  raw: string,
  options?: SplitConjunctionsOptions,
): string[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];

  // Container guard: when the line carries a container unit ("1 can chopped
  // tomatoes and onions"), the whole line describes one product — never
  // split.
  if (options?.containerTokens && options.containerTokens.size > 0) {
    const tokens = trimmed
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    for (const t of tokens) {
      if (options.containerTokens.has(t)) {
        return [trimmed];
      }
    }
  }

  const SPLIT_RE = /\s+(?:und|and|&)\s+/gi;
  const parts: string[] = [];
  let lastIndex = 0;

  function depthAt(idx: number): number {
    let depth = 0;
    for (let i = 0; i < idx; i++) {
      const c = trimmed[i];
      if (c === "(" || c === "[") depth += 1;
      else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    }
    return depth;
  }

  // Comma guard: the first comma at depth 0 marks the start of the prep /
  // notes section. Conjunctions after it connect prep instructions, not
  // ingredients ("Persian cucumbers, halved lengthwise and cut into pieces").
  function commaBefore(idx: number): boolean {
    let depth = 0;
    for (let i = 0; i < idx; i++) {
      const c = trimmed[i];
      if (c === "(" || c === "[") depth += 1;
      else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
      else if (c === "," && depth === 0) return true;
    }
    return false;
  }

  const lowerLine = trimmed.toLowerCase();

  for (const match of trimmed.matchAll(SPLIT_RE)) {
    const idx = match.index ?? 0;
    if (depthAt(idx) > 0) continue;
    const before = trimmed.slice(0, idx);
    const beforeTrimmed = before.replace(/\s+$/, "");
    const lastChar = beforeTrimmed[beforeTrimmed.length - 1];
    // Dash-compound exception: "Weizen- oder Dinkelmehl".
    if (lastChar === "-" || lastChar === "–") continue;
    // Comma guard.
    if (commaBefore(idx)) continue;
    // Color-adjective guard: "yellow and red grape tomatoes" / "Black and
    // White Pepper" — the conjunction connects parallel adjectives that
    // modify the same downstream noun, NOT two ingredients. Look at the
    // token immediately before and after the conjunction; if both are
    // color adjectives, skip the split.
    const wordBefore = /(\S+)\s*$/.exec(beforeTrimmed)?.[1] ?? "";
    const after = trimmed.slice(idx + match[0].length).trimStart();
    const wordAfter = /^(\S+)/.exec(after)?.[1] ?? "";
    if (
      wordBefore.length > 0 &&
      wordAfter.length > 0 &&
      isColorAdjective(wordBefore) &&
      isColorAdjective(wordAfter)
    ) {
      continue;
    }
    // Overlap guard: an existing ingredient name spans the conjunction —
    // user already has it as one row, so don't split.
    if (options?.knownIngredients && options.knownIngredients.size > 0) {
      const matchEnd = idx + match[0].length;
      let overlapped = false;
      for (const known of options.knownIngredients) {
        // Cheap skip for very short names — too noisy.
        if (known.length < 4) continue;
        // Cheap skip when the conjunction itself isn't inside the candidate.
        if (!known.includes(" ")) continue;
        let pos = lowerLine.indexOf(known);
        while (pos !== -1) {
          if (pos < idx && pos + known.length > matchEnd) {
            overlapped = true;
            break;
          }
          pos = lowerLine.indexOf(known, pos + 1);
        }
        if (overlapped) break;
      }
      if (overlapped) continue;
    }

    parts.push(trimmed.slice(lastIndex, idx).trim());
    lastIndex = idx + match[0].length;
  }
  parts.push(trimmed.slice(lastIndex).trim());

  const cleaned = parts.filter((p) => p.length > 0);
  return cleaned.length === 0 ? [trimmed] : cleaned;
}

/**
 * One unit of work after pre-expansion. Each input ingredient line can
 * produce zero or more of these — a single header, multiple ingredients,
 * or a mix (e.g. "Garnish: A, B, C" expands to one header + three
 * ingredients).
 */
export type ExpandedIngredientRow =
  | { kind: "header"; title: string; rawText: string }
  | {
      kind: "ingredient";
      /** What the downstream parser sees. May differ from {@link rawText}
       *  when a wrapper (Optional:, alternativ:, list-after-colon, each:)
       *  was stripped or rewrote the text. */
      text: string;
      /** The user's original input line (verbatim, trimmed). Used as
       *  `rawText` on the resulting `ImportedIngredient` so the import-
       *  review UI can show where the row came from. */
      rawText: string;
      /** Force the row to optional regardless of what the parser infers. */
      forceOptional: boolean;
      /** True for the non-first rows produced by `alternativ:` / `(Alternativ: X)`
       *  expansion. The downstream service layer turns this into an actual
       *  `recipe_ingredient.alternative_for_id` linking back to the most
       *  recent primary in the same section. */
      isAlternative: boolean;
      /** When `isAlternative` is true, the original connecting word (or
       *  short phrase) that joined this piece to its primary — "oder", "or",
       *  "/", "alternativ:", "Alternativ:". Lets the downstream parser fold
       *  the piece back into the primary's notes verbatim when the
       *  alternative doesn't match a catalog article. Null for primary rows. */
      alternativeConnector: string | null;
    };

const OPTIONAL_PREFIX_RE =
  /^\s*(?:optional|optionally|opt\.?|opional|optionale)\s*:\s*(.+)$/i;
/**
 * "alternativ" / "alternative" / "alternatively" / "alternativly" — colon
 * optional. Matches as a SEPARATOR token: surrounded by whitespace so
 * "vegetable alternative" or "no alternatives" prose doesn't accidentally
 * split. The trailing `\s+` requires at least one character after the
 * marker, which also rules out an end-of-line "X alternative".
 */
const ALTERNATIV_SEP_RE =
  /\s+(?:alternativ|alternative|alternatively|alternativly)\s*:?\s+/i;
const PARENS_ALTERNATIV_RE =
  /\s*\((alternativ|alternative|alternatively|alternativly)(?:\s*:\s*|\s+)([^)]+)\)\s*$/i;
const EACH_DIST_RE = /^(\S[^:]*?)\s+each\s*:\s*(.+)$/i;

/**
 * Split a comma- and "or"/"oder"-separated post-colon list into pieces.
 * Skips separators inside parens or brackets so "(28 oz., crushed)"
 * survives intact.
 */
function splitColonListItems(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  const out: string[] = [];
  let depth = 0;
  let current = "";
  let i = 0;
  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);

    if (depth === 0 && ch === ",") {
      out.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    if (depth === 0 && /\s/.test(ch)) {
      const rest = trimmed.slice(i);
      const m = /^\s+(?:or|oder)\s+/i.exec(rest);
      if (m) {
        out.push(current.trim());
        current = "";
        i += m[0].length;
        continue;
      }
    }
    current += ch;
    i += 1;
  }
  if (current.trim().length > 0) out.push(current.trim());
  return out.filter((s) => s.length > 0);
}

/**
 * Find the FIRST top-level " oder " / " or " / " / " separator in the
 * line, ignoring matches inside parens or brackets. Returns the match
 * range or null when none qualifies.
 */
function findOrSeparator(
  text: string,
): { index: number; length: number; word: string } | null {
  // " oder " / " or " / " / " — plus " o. " as German short form for
  // "oder". The negative lookahead skips "o. ä." / "o. Ä."
  // ("oder Ähnliches" = "or similar") which is a fixed phrase that belongs
  // in notes, not a separator.
  const sepRe = /\s+(?:oder|or)\s+|\s+o\.\s+(?!ä\.)|\s+\/\s+/gi;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;
    sepRe.lastIndex = i;
    const m = sepRe.exec(text);
    if (m && m.index === i) {
      return { index: m.index, length: m[0].length, word: m[0].trim() };
    }
  }
  return null;
}

/**
 * Split a line on EVERY top-level " oder " / " or " / " / " separator into its
 * segments, recording the connector word that preceded each (null for the
 * first). Separators inside parens/brackets are skipped (handled by
 * {@link findOrSeparator}). "A oder B oder C" → [{A,null},{B,oder},{C,oder}].
 */
function splitOrChain(
  text: string,
): { text: string; connector: string | null }[] {
  const segments: { text: string; connector: string | null }[] = [];
  let rest = text;
  let connector: string | null = null;
  for (;;) {
    const sep = findOrSeparator(rest);
    if (!sep) {
      segments.push({ text: rest.trim(), connector });
      return segments;
    }
    segments.push({ text: rest.slice(0, sep.index).trim(), connector });
    connector = sep.word;
    rest = rest.slice(sep.index + sep.length);
  }
}

/**
 * Returns true when `pre` (the text BEFORE an "oder"/"or" separator) carries
 * no head noun of its own — it's a quantity plus bare descriptor(s). In that
 * case the descriptors share the head noun that lives on the POST side, so
 * the line is one ingredient with alternative modifiers, not two ingredients
 * ("6 dried" in "6 dried or fresh shiitake mushrooms" — "dried"/"fresh" both
 * modify "shiitake mushrooms").
 *
 * When `pre` does have its own noun the post is a genuine alternative
 * ingredient and the line splits ("Rohrzucker" in "2 EL Rohrzucker oder
 * brauner Zucker" → Rohrzucker + brauner Zucker). Inspecting the pre side is
 * what distinguishes the two; the post side starts with a descriptor in both
 * ("fresh …", "brauner …"), so a post-only test can't tell them apart.
 */
function preIsHeadlessModifier(pre: string): boolean {
  const tokens = pre.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // Drop leading quantity-shaped tokens (numbers, ranges, fractions).
  let i = 0;
  while (i < tokens.length && /^[\d¼½¾⅓⅔⅛⅜⅝⅞.,/–-]+$/.test(tokens[i])) i += 1;
  const rest = tokens.slice(i);
  if (rest.length === 0) return false;
  return rest.every((t) => STANDALONE_DESCRIPTOR_NAMES.has(t));
}

/**
 * Pre-expansion pass over a single ingredient line. Catches patterns
 * where one input row should yield a different shape than "one ingredient":
 *
 *   - **Optional:/optionally:/opt.: prefix** — strip, mark forceOptional.
 *   - **`<qty> <unit> each: A, B, C`** — fan out into one row per item
 *     with shared qty+unit.
 *   - **Inline parens alternative `X (Alternativ: Y)`** — emit primary +
 *     alternative (alternative forced optional).
 *   - **`alternativ:` / `alternatively:` separator** — emit all parts
 *     with everything after the first marker forced optional.
 *   - **List-after-colon `Title: A, B, C`** — emit section header + one
 *     ingredient per comma-separated item.
 *
 * Anything that doesn't match a special pattern passes through as a
 * single ingredient with `rawText = text = rawLine`.
 *
 * The rules apply in order so e.g. `Optional: 1 EL Tahin alternativ: 1 EL Mandelmus`
 * first strips the Optional: prefix and then splits on alternativ:.
 */
export function expandIngredientLine(rawLine: string): ExpandedIngredientRow[] {
  const original = rawLine.trim();
  let body = original;
  let baseOptional = false;

  // 1. Status prefix.
  const statusMatch = OPTIONAL_PREFIX_RE.exec(body);
  if (statusMatch) {
    body = statusMatch[1].trim();
    baseOptional = true;
  }

  // 2. Each-distribution. Must run before list-after-colon since both
  //    have a colon-in-middle but each: needs a quantity-bearing prefix.
  const eachMatch = EACH_DIST_RE.exec(body);
  if (eachMatch && /[\d¼½¾⅓⅔⅛⅜⅝⅞]/.test(eachMatch[1])) {
    const qtyUnit = eachMatch[1].trim();
    const items = splitColonListItems(eachMatch[2]);
    if (items.length > 0) {
      return items.map((item) => ({
        kind: "ingredient" as const,
        text: `${qtyUnit} ${item}`,
        rawText: original,
        forceOptional: baseOptional,
        isAlternative: false,
        alternativeConnector: null,
      }));
    }
  }

  // 3. Inline parens alternative. Matches a trailing "(Alternativ: …)".
  //    The content may itself list several options ("(Alternativ Honig oder
  //    Zucker)") — split it into one alternative row per item so each gets
  //    matched/folded on its own.
  const parensAlt = PARENS_ALTERNATIV_RE.exec(body);
  if (parensAlt) {
    const primary = body.slice(0, parensAlt.index).trim();
    const altLeader = parensAlt[1];
    const altItems = splitColonListItems(parensAlt[2].trim());
    const rows: ExpandedIngredientRow[] = [];
    if (primary.length > 0) {
      rows.push({
        kind: "ingredient",
        text: primary,
        rawText: original,
        forceOptional: baseOptional,
        isAlternative: false,
        alternativeConnector: null,
      });
    }
    altItems.forEach((item, idx) => {
      // With a primary, every parenthetical item is an alternative to it.
      // Without one, a bare "(Alternativ: X)" emits its first item as a
      // standalone optional row and any further items as alternatives to it.
      const isAlt = primary.length > 0 || idx > 0;
      rows.push({
        kind: "ingredient",
        text: item,
        rawText: original,
        forceOptional: true,
        isAlternative: isAlt,
        // The first alternative carries the "Alternativ" leader; further items
        // (from "A oder B" inside the parens) connect with "oder".
        alternativeConnector: !isAlt
          ? null
          : idx === 0 && primary.length > 0
            ? `${altLeader}:`
            : "oder",
      });
    });
    return rows;
  }

  // 4. "alternativ:" / "alternative" / "alternatively" inline separator
  //    (colon optional).
  if (ALTERNATIV_SEP_RE.test(body)) {
    const sepMatch = ALTERNATIV_SEP_RE.exec(body);
    const connector = sepMatch ? sepMatch[0].trim() : "alternativ";
    const parts = body
      .split(ALTERNATIV_SEP_RE)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length >= 2) {
      const rows: ExpandedIngredientRow[] = [];
      parts.forEach((part, idx) => {
        if (idx === 0) {
          // Primary keeps the baseOptional status from any outer Optional:
          // wrapper.
          rows.push({
            kind: "ingredient",
            text: part,
            rawText: original,
            forceOptional: baseOptional,
            isAlternative: false,
            alternativeConnector: null,
          });
          return;
        }
        // Each alternative part may itself list several options
        // ("alternativ: Honig oder Zucker") — split into one row per item.
        // Alternatives are always optional; the first item carries the
        // "alternativ" leader, further "A oder B" items connect with "oder".
        splitColonListItems(part).forEach((item, itemIdx) => {
          rows.push({
            kind: "ingredient",
            text: item,
            rawText: original,
            forceOptional: true,
            isAlternative: true,
            alternativeConnector: itemIdx === 0 ? connector : "oder",
          });
        });
      });
      return rows;
    }
  }

  // 5. List-after-colon. Runs BEFORE the bare or/oder rule so a line
  //    like "optional garnishes: croutons, fresh herbs, or any leftover X"
  //    splits at the colon into a section + items rather than being eaten
  //    by the or-split rule. Skip when the post-colon part starts with a
  //    digit — that's the inverted "Name: qty unit" form already handled
  //    inside parseIngredientString.
  const colonMatch = /^([^:]+?)\s*:\s*(.+)$/.exec(body);
  if (colonMatch) {
    const titlePart = colonMatch[1].trim();
    const itemsPart = colonMatch[2].trim();
    const looksInverted = /^[\d¼½¾⅓⅔⅛⅜⅝⅞]/.test(itemsPart);
    if (!looksInverted && titlePart.length > 0 && itemsPart.length > 0) {
      const items = splitColonListItems(itemsPart);
      if (items.length > 0) {
        // A title that mentions "optional" / "nach Belieben" propagates
        // the optional flag onto every item it introduces ("optional
        // garnishes: croutons, herbs, …").
        const titleHasOptional =
          /\b(?:optional|optionally|nach\s+belieben)\b/i.test(titlePart);
        const forceOptional = baseOptional || titleHasOptional;
        const rows: ExpandedIngredientRow[] = [
          { kind: "header", title: titlePart, rawText: original },
        ];
        for (const item of items) {
          rows.push({
            kind: "ingredient",
            text: item,
            rawText: original,
            forceOptional,
            isAlternative: false,
            alternativeConnector: null,
          });
        }
        return rows;
      }
    }
  }

  // 6. " oder " / " or " / " / " / " o. " inline alternative separator.
  //    Splits the WHOLE chain into a primary + one optional alternative per
  //    further option, so "A oder B oder C" emits A primary + B alt + C alt
  //    (consistent with the parens / "alternativ:" forms above). An option
  //    the catalog doesn't recognise folds back into the primary's notes
  //    downstream, so over-splitting prose is self-correcting.
  //
  //    Guards (checked on the primary — the first segment):
  //      - must not end with "-" (preserves compound stems like
  //        "Weizen- oder Dinkelmehl" — those are first stitched together
  //        by preprocessAlternatives in the Familywall opt-in).
  //      - must carry its own head noun (preserves "6 dried or fresh
  //        shiitake mushrooms" — "6 dried" is headless, so "dried"/"fresh"
  //        share the post's "shiitake mushrooms"). See
  //        {@link preIsHeadlessModifier}.
  if (findOrSeparator(body)) {
    const segments = splitOrChain(body);
    const primary = segments[0];
    if (
      segments.every((s) => s.text.length > 0) &&
      !primary.text.endsWith("-") &&
      !preIsHeadlessModifier(primary.text)
    ) {
      return segments.map((seg, idx) => ({
        kind: "ingredient" as const,
        text: seg.text,
        rawText: original,
        forceOptional: idx === 0 ? baseOptional : true,
        isAlternative: idx > 0,
        alternativeConnector: idx > 0 ? seg.connector : null,
      }));
    }
  }

  // Pass through.
  return [
    {
      kind: "ingredient",
      text: body,
      rawText: original,
      forceOptional: baseOptional,
      isAlternative: false,
      alternativeConnector: null,
    },
  ];
}
