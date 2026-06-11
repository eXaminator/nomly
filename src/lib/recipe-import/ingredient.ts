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

type RangeResult = {
  quantity: number;
  /** When the input was a range, the original expression (e.g. "1-2") for
   * inclusion in the notes. Null otherwise. */
  rangeExpression: string | null;
};

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

/**
 * Genitive linkers that are noise at a notes-fragment EDGE ("strip of",
 * "Saft von") but nothing more — deliberately tiny. Words like "to",
 * "plus", "und" carry meaning in notes ("to taste", "plus more for
 * serving", "und/oder …") and stay verbatim per the raw-remainder rule.
 */
const REMAINDER_EDGE_FILLER = new Set(["of", "von", "vom"]);

/**
 * Presentation cleanup for a raw-remainder notes fragment (the verbatim
 * source text around a matched span):
 *   - parentheses become COMMA separators ("(natural) smooth" →
 *     "natural, smooth") — one rule that also covers whole-fragment wraps
 *     ("(crunchy)" → "crunchy"), orphan halves left by a match span cutting
 *     through a parenthetical, and doubled pairs ("((x))" → "x");
 *   - comma/whitespace runs are normalised;
 *   - edge separators and edge-adjacent genitive linkers (see
 *     {@link REMAINDER_EDGE_FILLER}) are trimmed iteratively.
 * Returns null when nothing meaningful is left.
 */
export function tidyRemainderFragment(s: string): string | null {
  let text = s.trim().replace(/\s*[()]\s*/g, ", ");
  // Normalise the comma runs the paren replacement may have produced —
  // but ONLY separator commas. A comma directly between two digits is a
  // German decimal ("1-1,5") and must stay glued (same discrimination the
  // tokenizer's comma padding uses).
  text = text.replace(/\s*(?:(?<!\d),|,(?!\d))[\s,]*/g, ", ");
  let prev: string | null = null;
  while (prev !== text) {
    prev = text;
    text = text.replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "");
    const toks = text.split(/\s+/).filter((t) => t.length > 0);
    const isFiller = (t: string) =>
      REMAINDER_EDGE_FILLER.has(t.toLowerCase().replace(/[.,;]$/, ""));
    // A leading linker that introduces a quantified source stays ("von ca.
    // 300 g rohem Kürbis", "of 2 lemons") — only a bare-descriptor linker
    // ("of small head") is noise. A trailing linker ("Schale von") is always
    // noise.
    while (
      toks.length > 0 &&
      isFiller(toks[0]) &&
      !toks.slice(1).some((t) => /\d/.test(t))
    ) {
      toks.shift();
    }
    while (toks.length > 0 && isFiller(toks[toks.length - 1])) toks.pop();
    text = toks.join(" ");
  }
  return text.length > 0 ? text : null;
}

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
      /** True when this alternative's note belongs to IT ALONE and must not
       *  propagate to siblings — e.g. a note inside a parenthetical
       *  alternative ("Salz (oder Pfeffer, frisch gemahlen)" → "frisch
       *  gemahlen" is Pfeffer's, not Salz's). A line-trailing note in a bare
       *  "A or B, diced" chain stays shareable, so it's left false there. */
      localNote?: boolean;
      /** A note that trailed a parenthetical alternative in the source
       *  ("(or 1 large clove), peeled" → "peeled"). It belongs to the primary
       *  but must land AFTER the alternatives fold in, so it's carried here and
       *  appended by the caller once the line's rows are all processed —
       *  appending it to the primary text up front would reorder the notes. */
      tailNote?: string;
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
/**
 * Leader of a trailing alternative parenthetical, matched against the paren's
 * INNER text. Group 1 = the marker word ("alternativ", "sub", …), group 2 =
 * the alternative content (which may itself contain nested parens). A leading
 * "or"/"oder" before the marker is tolerated ("(or alternative X)").
 */
const ALT_PAREN_LEADER_RE =
  /^(?:(?:or|oder)\s+)?(alternativ|alternative|alternatively|alternativly|substituted?(?:\s+with)?|sub\.?|ersatzweise|notfalls)(?:\s*:\s*|\s+)([\s\S]+)$/i;
/** A trailing paren that simply opens with "oder"/"or" — "(oder X)" — is an
 *  alternative too, even without an "alternativ" marker. Group 1 = the leader
 *  word (kept verbatim so an English "or" doesn't anglicise to "oder" in
 *  notes), group 2 = content. */
const BARE_OR_PAREN_LEADER_RE = /^(or|oder)(?:\s*:\s*|\s+)([\s\S]+)$/i;
/**
 * Leading substitute marker on an alternative SEGMENT ("or sub sour cream"
 * → strip "sub" so the alternative's name stays clean). Same line-structure
 * vocabulary category as "alternativ:" — it marks the alternative role,
 * never ingredient identity.
 */
const SUB_MARKER_RE = /^(?:substituted?(?:\s+with)?|sub\.?|ersatzweise|notfalls)\s+/i;
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
      // A comma between two digits is a decimal point ("1,5"), not a list
      // separator — keep it glued to the number.
      const decimal = /\d/.test(trimmed[i - 1] ?? "") && /\d/.test(trimmed[i + 1] ?? "");
      if (!decimal) {
        out.push(current.trim());
        current = "";
        i += 1;
        continue;
      }
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
 * Split a parenthetical alternative's content into one option per top-level
 * "oder"/"or" ONLY — commas stay glued, because inside an alternative a comma
 * separates the ingredient from its own note ("1 kl. Glas Spargelköpfe,
 * Abtropfgew. 115 g" is ONE alternative with a drained-weight note), not two
 * alternatives. Separators inside parens/brackets are skipped.
 */
function splitOrOptions(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  const out: string[] = [];
  let depth = 0;
  let current = "";
  let i = 0;
  // Trailing separator left when a "X, oder Y" comma sits before the "oder"
  // we split on ("ungesalzen," → "ungesalzen"). Internal commas survive.
  const clean = (s: string) => s.trim().replace(/[,;]+$/, "").trim();
  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(ch)) {
      const m = /^\s+(?:or|oder)\s+/i.exec(trimmed.slice(i));
      if (m) {
        out.push(clean(current));
        current = "";
        i += m[0].length;
        continue;
      }
    }
    current += ch;
    i += 1;
  }
  if (clean(current).length > 0) out.push(clean(current));
  return out.filter((s) => s.length > 0);
}

/**
 * Detect a trailing alternative parenthetical — "(Alternativ: X)",
 * "(alternativ X)", or a bare "(oder X)" / "(or X)" — and split it from the
 * primary. The closing paren is matched to its opener by a balanced backward
 * scan, so a nested prep paren rides along with the alternative content
 * ("Kidneybohnen (oder schwarze Bohnen (abgetropft))" → content keeps the
 * inner paren). Returns null when the line has no trailing paren or the paren
 * isn't an alternative (an ordinary note like "(gehackt)").
 *
 * `connector` is the word the first alternative folds back with when it
 * doesn't match a catalog article: "<marker>:" for an explicit marker, "oder"
 * for a bare or-paren. Further items from an inner "A oder B" list connect
 * with "oder" (decided by the caller).
 */
function extractTrailingParenAlternative(
  body: string,
): { primary: string; content: string; connector: string; tail: string } | null {
  const trimmed = body.trimEnd();
  // The alternative paren is usually line-final, but a short note can trail it
  // ("(or chili flakes) more to taste"). Locate the last ")" and treat any
  // text after it as a tail — UNLESS that tail carries a list separator
  // (und/and/oder/or/sowie), which signals more ingredients rather than a note
  // and is left to the conjunction splitter.
  const close = trimmed.lastIndexOf(")");
  if (close < 0) return null;
  const tail = trimmed.slice(close + 1).trim();
  if (tail.length > 0 && /\b(?:und|and|oder|or|sowie)\b/i.test(tail)) return null;
  let depth = 0;
  let open = -1;
  for (let i = close; i >= 0; i--) {
    const ch = trimmed[i];
    if (ch === ")") depth += 1;
    else if (ch === "(") {
      depth -= 1;
      if (depth === 0) {
        open = i;
        break;
      }
    }
  }
  if (open < 0) return null; // unbalanced — leave it to the note path
  let inner = trimmed.slice(open + 1, close).trim();
  let primary = trimmed.slice(0, open).trim();
  // A leading parenthetical inside the alt-paren that precedes the leader
  // ("((10 g) oder Ahornsirup)") is a note on the PRIMARY, not part of the
  // alternative — hoist it onto the primary so "oder Ahornsirup" can match.
  const leadParen = /^(\([^()]*\))\s*(?=(?:or|oder|alternativ|alternative|ersatzweise|notfalls|sub)\b)/i.exec(
    inner,
  );
  if (leadParen) {
    primary = `${primary} ${leadParen[1]}`.trim();
    inner = inner.slice(leadParen[0].length).trim();
  }
  const altMatch = ALT_PAREN_LEADER_RE.exec(inner);
  if (altMatch) {
    return { primary, content: altMatch[2].trim(), connector: `${altMatch[1]}:`, tail };
  }
  const orMatch = BARE_OR_PAREN_LEADER_RE.exec(inner);
  if (orMatch) {
    return {
      primary,
      content: orMatch[2].trim(),
      connector: orMatch[1].toLowerCase(),
      tail,
    };
  }
  return null;
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

  // 3. Inline parens alternative. Matches a trailing "(Alternativ: …)" or a
  //    bare "(oder …)" / "(or …)". The content may itself list several
  //    options ("(Alternativ Honig oder Zucker)") — split it into one
  //    alternative row per item so each gets matched/folded on its own. A
  //    nested prep paren stays with the content ("(oder schwarze Bohnen
  //    (abgetropft))").
  const parensAlt = extractTrailingParenAlternative(body);
  if (parensAlt) {
    const altLeader = parensAlt.connector;
    // Each option is separated by "oder"/"or" only — a comma inside an option
    // is its own note ("1 kl. Glas Spargelköpfe, Abtropfgew. 115 g").
    const altItems = splitOrOptions(parensAlt.content);
    const rows: ExpandedIngredientRow[] = [];
    // A note tail after the paren ("(or 1 large clove), peeled") belongs to the
    // primary but must land AFTER the alternatives in the notes — appending it
    // to the primary text here would put it before them. Carry it as tailNote
    // on the first emitted row instead; the caller appends it once folds are in.
    const tailNote = parensAlt.tail
      ? parensAlt.tail.replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "")
      : "";
    // Re-expand the primary so its OWN "oder"/"alternativ" chain splits too
    // ("Weizenmehl oder Dinkelmehl (oder glutenfrei)" → 3 rows). The first
    // emitted row is the real primary; the rest are its alternatives.
    if (parensAlt.primary.length > 0) {
      expandIngredientLine(parensAlt.primary).forEach((r, idx) => {
        if (r.kind !== "ingredient") {
          rows.push({ ...r, rawText: original });
          return;
        }
        rows.push({
          ...r,
          rawText: original,
          forceOptional: idx === 0 ? baseOptional || r.forceOptional : r.forceOptional,
          ...(idx === 0 && tailNote ? { tailNote } : {}),
        });
      });
    }
    const hasPrimary = rows.some((r) => r.kind === "ingredient" && !r.isAlternative);
    altItems.forEach((item, idx) => {
      // With a primary, every parenthetical item is an alternative to it.
      // Without one, a bare "(Alternativ: X)" emits its first item as a
      // standalone optional row and any further items as alternatives to it.
      const isAlt = hasPrimary || idx > 0;
      rows.push({
        kind: "ingredient",
        text: item,
        rawText: original,
        forceOptional: true,
        isAlternative: isAlt,
        // The first alternative carries the paren's leader ("Alternativ:" or
        // "oder"); further items (from "A oder B" inside the parens) connect
        // with "oder".
        alternativeConnector: !isAlt
          ? null
          : idx === 0 && hasPrimary
            ? altLeader
            : "oder",
        // A note inside this parenthetical alternative is the alternative's
        // own ("(oder Pfeffer, frisch gemahlen)") — don't share it with the
        // primary or other siblings.
        localNote: true,
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
        // Alternatives may carry a leading substitute marker ("or sub sour
        // cream") — strip it so the alternative's text is just the product.
        text: idx > 0 ? seg.text.replace(SUB_MARKER_RE, "") : seg.text,
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
