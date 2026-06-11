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

import { lex } from "./ast/lexer.ts";

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
  const text = raw.trim();
  if (text.length === 0) return null;
  // Lex once; the structural decisions (brackets, "Part N", dash rules, the
  // trailing colon, all-caps) read off the leaves. Only the emoji probe stays
  // character-level — an emoji isn't its own lexeme kind.
  const leaves = lex(text);
  if (leaves.length === 0) return null;
  const first = leaves[0];
  const last = leaves[leaves.length - 1];

  // "[Sauce]" — a bracket pair wrapping the whole line: classify the inside.
  if (
    leaves.length >= 2 &&
    first.kind === "open" && first.bracket &&
    last.kind === "close" && last.bracket
  ) {
    return detectSectionHeader(text.slice(first.end, last.start));
  }

  // "Part 1: Sauce" / "Teil 2: Beilage" — leading "part"/"teil" + number; the
  // title is whatever follows (an optional ":"/"." after the number is dropped).
  if (
    first.kind === "word" && /^(?:part|teil)$/i.test(first.text) &&
    leaves[1]?.kind === "number"
  ) {
    let i = 2;
    if (leaves[i]?.kind === "punct" && (leaves[i].text === ":" || leaves[i].text === ".")) {
      i += 1;
    }
    const rest = leaves[i] ? text.slice(leaves[i].start).trim() : "";
    return rest.length > 0 ? rest : text;
  }

  // Leading/trailing run of 2+ dashes ("--- For the sauce ---").
  let lead = 0;
  while (leaves[lead]?.kind === "dash") lead += 1;
  let trail = 0;
  while (leaves[leaves.length - 1 - trail]?.kind === "dash") trail += 1;
  if (lead >= 2 || trail >= 2) {
    const startLeaf = leaves[lead];
    const endLeaf = leaves[leaves.length - 1 - trail];
    if (!startLeaf || !endLeaf || startLeaf.start > endLeaf.start) return null;
    return text.slice(startLeaf.start, endLeaf.end).trim() || null;
  }

  // Leading emoji.
  if (EMOJI_LEAD_RE.test(text)) {
    return text.replace(EMOJI_LEAD_RE, "").trim() || null;
  }

  // Ends with a colon ("Für den Teig:" → "Für den Teig").
  if (last.kind === "punct" && last.text === ":") {
    return text.slice(0, last.start).trim() || null;
  }

  // All-caps: ≥4 letters across the word leaves, none lowercase.
  const letters = leaves
    .filter((l) => l.kind === "word")
    .flatMap((l) => [...l.text])
    .filter((c) => /\p{L}/u.test(c));
  if (letters.length >= 4 && letters.every((c) => c === c.toLocaleUpperCase("de"))) {
    return text;
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

export function isColorAdjective(token: string): boolean {
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
 * Returns true when `pre` (the text BEFORE an "oder"/"or" separator) carries no
 * head noun of its own — a quantity plus bare descriptor(s). Then the
 * descriptors share the head noun on the POST side, so the line is one
 * ingredient with alternative modifiers, not two ("6 dried" in "6 dried or
 * fresh shiitake mushrooms"). Used by the AST segmenter's or-chain guard.
 */
export function preIsHeadlessModifier(pre: string): boolean {
  const tokens = pre.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^[\d¼½¾⅓⅔⅛⅜⅝⅞.,/–-]+$/.test(tokens[i])) i += 1;
  const rest = tokens.slice(i);
  if (rest.length === 0) return false;
  return rest.every((t) => STANDALONE_DESCRIPTOR_NAMES.has(t));
}

