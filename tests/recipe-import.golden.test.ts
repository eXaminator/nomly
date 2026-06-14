/**
 * "Golden" parser coverage test against a curated subset of family-wall
 * ingredient lines. Each entry pairs a raw line with the LLM-annotated
 * "ideal" parse outcome — what a perfect parser would extract, regardless
 * of what our current heuristics actually produce.
 *
 * Dataset: 4,595 unique ingredient lines were extracted from
 * data/familywall-cache/ via scripts/dump-ingredients.mts. Hand-annotating
 * every one is impractical (most are minor variants — "1 Bund Basilikum"
 * vs "1 Bund Petersilie" — so the marginal information per case is low).
 * Instead this file curates ~100 representatives that cover every distinct
 * pattern observed.
 *
 * The test is INFORMATIONAL, not pass/fail: it scores each case as
 * exact / partial / fail and prints a coverage report. Failing cases are
 * the parser long tail; growing the parser shrinks the failure list.
 *
 * Scoring:
 *   exact   — quantity + unitName + name all match, notes substrings all
 *             appear, isOptional matches when specified
 *   partial — quantity + name match but unit and/or notes drift
 *   fail    — quantity or name is wrong
 */

import { describe, it, expect } from "vitest";

import { parseIngredientLines, type ParseLookups } from "@/lib/recipe-import";

/**
 * The full set of unit tokens the parser sees in production — names +
 * aliases from `src/db/seed-data/units.ts` (the curated `SEED_UNITS` list)
 * plus the app-specific `topUpUnits` in `src/db/seed.ts`. If you add a
 * unit/alias to the seed, mirror it here so the golden test stays
 * representative.
 */
const TEST_UNITS = new Set(
  [
    // Mass
    "g", "kg",
    "gr", "gr.",
    "gram", "grams", "gramm", "Gramm",
    "kilo", "kilogram", "kilograms", "kilogramm", "Kilo", "Kilogramm",
    "lb", "lbs", "Pfund", "pound", "pounds",
    "oz", "ounce", "ounces",
    // Volume
    "ml", "cl", "dl", "l",
    "milliliter", "milliliters", "Milliliter",
    "liter", "liters", "Liter",
    "fl oz",
    "EL", "Esslöffel", "Eßlöffel", "esslöffel",
    "TL", "Teelöffel", "teelöffel",
    "tbsp", "tbsp.", "tbsps", "tablespoon", "tablespoons",
    "tsp", "tsp.", "tsps", "teaspoon", "teaspoons",
    "Cup", "Cups", "cup", "cups", "c", "c.",
    "Tasse", "Tassen", "tassen",
    "Prise", "Prisen", "PR", "pinch", "pinches",
    "Messerspitze", "Messerspitzen", "Msp", "Msp.", "knife tip",
    // Count + handful-like
    "Stück", "Stk", "Stk.", "St.", "x", "piece", "pieces", "stick", "sticks", "pcs",
    "Bund", "Bunde", "Bündel", "Bd", "Bd.", "bunch", "bunches",
    "Handvoll", "Hand voll", "handful", "handfuls",
    "Zweig", "Zweige", "twig", "twigs", "sprig", "sprigs",
    "Zehe", "Zehen", "clove", "cloves",
    // Length
    "Zoll", "Inch", "inch", "inches", "-inch", '"',
    "cm", "Zentimeter", "zentimeter", "centimeter", "centimeters", "-cm",
    // Containers
    "Packung", "Packungen", "Päckchen", "Pck", "Pck.", "Pkg", "Pkg.", "Pckg", "Pckg.",
    "package", "packages", "packet", "packets",
    "Dose", "Dosen", "can", "cans", "tin", "tins",
    "Glas", "Gläser", "jar", "jars",
    "Tube", "Tuben", "tubes",
    "Flasche", "Flaschen", "Bottle", "Bottles", "bottle", "bottles",
    "Karton", "Kartons", "carton", "cartons",
    "Schachtel", "Schachteln", "box", "boxes",
    "Beutel", "Beuteln", "sachet", "sachets", "bag", "bags",
  ].map((u) => u.toLowerCase()),
);

// Container tokens: when a line carries one, the matcher keeps a leading prep
// adjective in the name (canned-product rule).
const CONTAINER_TOKENS = new Set(
  [
    "packung", "packungen", "päckchen", "pck", "pck.", "pkg", "pkg.", "pckg", "pckg.",
    "package", "packages", "packet", "packets",
    "dose", "dosen", "can", "cans", "tin", "tins",
    "glas", "gläser", "jar", "jars",
    "tube", "tuben", "tubes",
    "flasche", "flaschen", "bottle", "bottles",
    "karton", "kartons", "carton", "cartons",
    "schachtel", "schachteln", "box", "boxes",
    "beutel", "beuteln", "sachet", "sachets", "bag", "bags",
  ],
);

// Display casing for the resolved unit name (the pipeline canonicalises; the
// old standalone parser echoed the verbatim token). Aliases not listed default
// to their lowercased token.
const UNIT_CASING: Record<string, string> = {
  tl: "TL", el: "EL", esslöffel: "Esslöffel", "eßlöffel": "Esslöffel",
  teelöffel: "Teelöffel", tasse: "Tasse", tassen: "Tassen",
  gramm: "Gramm", kilo: "Kilo", kilogramm: "Kilogramm",
  liter: "Liter", milliliter: "Milliliter",
  prise: "Prise", prisen: "Prisen", messerspitze: "Messerspitze",
  msp: "Msp", "msp.": "Msp.", stück: "Stück", stk: "Stk", "stk.": "Stk.",
  bund: "Bund", bündel: "Bündel", zweig: "Zweig", zweige: "Zweige",
  zehe: "Zehe", zehen: "Zehen", zoll: "Zoll", zentimeter: "Zentimeter",
  handvoll: "Handvoll", packung: "Packung", packungen: "Packungen",
  päckchen: "Päckchen", pck: "Pck", "pck.": "Pck.", dose: "Dose", dosen: "Dosen",
  glas: "Glas", gläser: "Gläser", tube: "Tube", tuben: "Tuben",
  flasche: "Flasche", flaschen: "Flaschen", karton: "Karton", kartons: "Kartons",
  schachtel: "Schachtel", schachteln: "Schachteln", beutel: "Beutel", beuteln: "Beuteln",
  pfund: "Pfund",
};

const UNIT_ENTRIES = [...TEST_UNITS].map(
  (name, i) =>
    [
      name,
      { id: i + 1, name: UNIT_CASING[name] ?? name, isContainer: CONTAINER_TOKENS.has(name) },
    ] as const,
);
const TEST_LOOKUPS: ParseLookups = {
  units: {
    byNameOrAlias: new Map(UNIT_ENTRIES),
    byCanonicalName: new Map(UNIT_ENTRIES),
    byId: new Map(UNIT_ENTRIES.map(([, e]) => [e.id, e] as const)),
    containerTokens: CONTAINER_TOKENS,
    unspecificTokens: new Set(),
    maxUnitTokens: 1,
    globalDefaultUnitId: null,
  },
  ingredients: new Map(),
  ingredientCatalog: [],
};

/** The legacy ParsedIngredient-ish shape the scoring below reads, produced by
 *  running the real production pipeline on a single line. */
type ParsedShape = {
  quantity: number | null;
  unitName: string | null;
  name: string;
  notes: string | null;
  isOptional: boolean;
};

/** Run the full production pipeline on one line and adapt the first emitted
 *  ImportedIngredient back to {@link ParsedShape}. The raw unit token is
 *  preferred so the report echoes the source spelling like the old parser. */
function parse(raw: string): ParsedShape {
  const out = parseIngredientLines([raw], TEST_LOOKUPS);
  const r = out[0];
  return {
    quantity: r?.quantity ?? null,
    unitName: r?.rawUnit ?? r?.unit?.name ?? null,
    name: r?.name ?? "",
    notes: r?.notes ?? null,
    isOptional: r?.isOptional ?? false,
  };
}

type Ideal = {
  quantity?: number | null;
  unitName?: string | null;
  name?: string;
  /** Substring matches — every entry MUST appear (case-insensitive) in
   *  the parser's notes string. Order-independent. */
  notesContains?: string[];
  isOptional?: boolean;
};

type Case = { raw: string; ideal: Ideal };

/**
 * Hand-annotated golden cases. Grouped by pattern for readability. Each
 * comment block calls out what the case is intended to exercise so it's
 * clear which heuristic each row is gating.
 */
const CASES: Case[] = [
  // ──────────────────────────── Simple German "qty + unit + name" ────────
  { raw: "500 g Hackfleisch", ideal: { quantity: 500, unitName: "g", name: "Hackfleisch" } },
  { raw: "250 g Mehl", ideal: { quantity: 250, unitName: "g", name: "Mehl" } },
  { raw: "100 g Zucker", ideal: { quantity: 100, unitName: "g", name: "Zucker" } },
  { raw: "300 g Dinkelvollkornmehl", ideal: { quantity: 300, unitName: "g", name: "Dinkelvollkornmehl" } },
  { raw: "45 g Honig", ideal: { quantity: 45, unitName: "g", name: "Honig" } },
  { raw: "15 g Salz", ideal: { quantity: 15, unitName: "g", name: "Salz" } },
  { raw: "1 EL Öl", ideal: { quantity: 1, unitName: "EL", name: "Öl" } },
  { raw: "2 TL Salz", ideal: { quantity: 2, unitName: "TL", name: "Salz" } },
  { raw: "200 ml Birnensaft", ideal: { quantity: 200, unitName: "ml", name: "Birnensaft" } },
  { raw: "550 ml Milch", ideal: { quantity: 550, unitName: "ml", name: "Milch" } },
  { raw: "1 TL Kurkuma", ideal: { quantity: 1, unitName: "TL", name: "Kurkuma" } },
  { raw: "1 TL Chiliflocken", ideal: { quantity: 1, unitName: "TL", name: "Chiliflocken" } },
  { raw: "2 EL Pinienkerne", ideal: { quantity: 2, unitName: "EL", name: "Pinienkerne" } },
  { raw: "3 EL Hatcho Miso", ideal: { quantity: 3, unitName: "EL", name: "Hatcho Miso" } },
  { raw: "120 ml heißes Wasser", ideal: { quantity: 120, unitName: "ml", name: "Wasser", notesContains: ["heiß"] } },
  { raw: "2 Esslöffel Öl", ideal: { quantity: 2, unitName: "Esslöffel", name: "Öl" } },
  { raw: "150 g Feta", ideal: { quantity: 150, unitName: "g", name: "Feta" } },
  { raw: "150 gr. Joghurt", ideal: { quantity: 150, unitName: "gr", name: "Joghurt" } },
  { raw: "400ml. passierte Tomaten", ideal: { quantity: 400, unitName: "ml", name: "passierte Tomaten" } },
  { raw: "1TL Puderzucker", ideal: { quantity: 1, unitName: "TL", name: "Puderzucker" } },
  { raw: "40 Gramm brauner Zucker", ideal: { quantity: 40, unitName: "Gramm", name: "brauner Zucker" } },

  // ──────────────────────────── Simple English "qty + unit + name" ───────
  { raw: "2 tablespoons lemon juice", ideal: { quantity: 2, unitName: "tablespoons", name: "lemon juice" } },
  { raw: "3 tablespoons olive oil", ideal: { quantity: 3, unitName: "tablespoons", name: "olive oil" } },
  { raw: "3 tablespoons honey", ideal: { quantity: 3, unitName: "tablespoons", name: "honey" } },
  { raw: "1 teaspoon cumin seeds", ideal: { quantity: 1, unitName: "teaspoon", name: "cumin seeds" } },
  { raw: "170 g dark chocolate", ideal: { quantity: 170, unitName: "g", name: "dark chocolate" } },
  { raw: "170g light brown sugar", ideal: { quantity: 170, unitName: "g", name: "light brown sugar" } },
  { raw: "500g of unsalted butter", ideal: { quantity: 500, unitName: "g", name: "unsalted butter" } },
  { raw: "1 cup (200g) granulated sugar", ideal: { quantity: 1, unitName: "cup", name: "granulated sugar", notesContains: ["200"] } },
  { raw: "3 cups all-purpose flour (360g)", ideal: { quantity: 3, unitName: "cups", name: "all-purpose flour", notesContains: ["360"] } },
  { raw: "1 cup (240g) sour cream, room temperature", ideal: { quantity: 1, unitName: "cup", name: "sour cream", notesContains: ["240", "room temperature"] } },

  // ──────────────────────────── Fractions (unicode + ASCII) ──────────────
  { raw: "½ teaspoon ground nutmeg", ideal: { quantity: 0.5, unitName: "teaspoon", name: "ground nutmeg" } },
  { raw: "½ teaspoon orange zest, optional", ideal: { quantity: 0.5, unitName: "teaspoon", name: "orange zest", isOptional: true } },
  { raw: "1/4 c. finely chopped tomatoes", ideal: { quantity: 0.25, unitName: "c", name: "tomatoes", notesContains: ["finely chopped"] } },
  { raw: "1/2 c. white balsamic vinegar", ideal: { quantity: 0.5, unitName: "c", name: "white balsamic vinegar" } },
  { raw: "1/2 EL Sojasauce ((*siehe Anmerkungen))", ideal: { quantity: 0.5, unitName: "EL", name: "Sojasauce", notesContains: ["siehe Anmerkungen"] } },
  { raw: "0.5 TL Muskat", ideal: { quantity: 0.5, unitName: "TL", name: "Muskat" } },
  { raw: "¾ cup chopped semisweet chocolate chips ((130g))", ideal: { quantity: 0.75, unitName: "cup", name: "semisweet chocolate chips", notesContains: ["chopped", "130"] } },
  { raw: "1 ½ teaspoons sage", ideal: { quantity: 1.5, unitName: "teaspoons", name: "sage" } },
  { raw: "1 ½ teaspoon cinnamon", ideal: { quantity: 1.5, unitName: "teaspoon", name: "cinnamon" } },
  // "frozen" is identity-bearing (different SKU than fresh corn) — stays
  // in the ingredient name. Same rule applies to TK / gefroren / getrocknet.
  { raw: "1 1/2 c. frozen corn", ideal: { quantity: 1.5, unitName: "c", name: "frozen corn" } },
  { raw: "1 1/2 cups freshly grated parmesan cheese", ideal: { quantity: 1.5, unitName: "cups", name: "parmesan cheese", notesContains: ["freshly grated"] } },
  { raw: "1 1/2 teaspoon Vanilla Paste - or extract", ideal: { quantity: 1.5, unitName: "teaspoon", name: "Vanilla Paste", notesContains: ["extract"] } },
  { raw: "1 ½ EL frisch geriebener Ingwer", ideal: { quantity: 1.5, unitName: "EL", name: "Ingwer", notesContains: ["frisch gerieben"] } },

  // ──────────────────────────── Ranges ────────────────────────────────────
  // Convention: ranges always resolve to the HIGH bound. The full range
  // expression is preserved in notes so the reader still sees the spread.
  { raw: "2-3 EL Honig", ideal: { quantity: 3, unitName: "EL", name: "Honig", notesContains: ["2"] } },
  // "gemahlener" stays in the name — ground cumin is a different product
  // than whole cumin seeds.
  { raw: "0.5 - 1 TL gemahlener Kreuzkümmel", ideal: { quantity: 1, unitName: "TL", name: "gemahlener Kreuzkümmel", notesContains: ["0.5"] } },
  { raw: "0.5 - 1 TL Pfeffer", ideal: { quantity: 1, unitName: "TL", name: "Pfeffer", notesContains: ["0.5"] } },
  { raw: "0.5 - 1 TL Salz", ideal: { quantity: 1, unitName: "TL", name: "Salz", notesContains: ["0.5"] } },
  { raw: "1 - 2 EL Tomatenmark", ideal: { quantity: 2, unitName: "EL", name: "Tomatenmark", notesContains: ["1"] } },
  { raw: "1 - 2 EL gelbe Currypaste (je nach Schärfe)", ideal: { quantity: 2, unitName: "EL", name: "gelbe Currypaste", notesContains: ["1", "je nach Schärfe"] } },
  { raw: "100-150 ml Wasser", ideal: { quantity: 150, unitName: "ml", name: "Wasser", notesContains: ["100"] } },
  { raw: "0, 5-1 TL Sambal Oelek", ideal: { quantity: 1, unitName: "TL", name: "Sambal Oelek", notesContains: ["0"] } },

  // ──────────────────────────── Container units (DE + EN) ────────────────
  { raw: "1 Dose Kichererbsen (400 Gramm)", ideal: { quantity: 1, unitName: "Dose", name: "Kichererbsen", notesContains: ["400"] } },
  { raw: "1 Bund Bärlauch", ideal: { quantity: 1, unitName: "Bund", name: "Bärlauch" } },
  { raw: "1 Bund Basilikum", ideal: { quantity: 1, unitName: "Bund", name: "Basilikum" } },
  { raw: "1 Bund Lauchzwiebeln", ideal: { quantity: 1, unitName: "Bund", name: "Lauchzwiebeln" } },
  { raw: "1 Bund Palmkohl", ideal: { quantity: 1, unitName: "Bund", name: "Palmkohl" } },
  { raw: "1 Bund frische Kräuter (z.B. glatte Petersilie oder Koriander)", ideal: { quantity: 1, unitName: "Bund", name: "frische Kräuter", notesContains: ["z.B."] } },
  { raw: "1 Beutel Mildessa Mildes Sauerkraut (400 g)", ideal: { quantity: 1, unitName: "Beutel", name: "Mildessa Mildes Sauerkraut", notesContains: ["400"] } },
  { raw: "1 (15 oz.) can black beans", ideal: { quantity: 1, unitName: "can", name: "black beans", notesContains: ["15", "oz"] } },
  // `can` IS a container — the integration layer keeps the FULL name
  // (prep adjective is part of the canned-product label).
  { raw: "1 (15-oz.) can chopped fire-roasted tomatoes", ideal: { quantity: 1, unitName: "can", name: "chopped fire-roasted tomatoes", notesContains: ["15"] } },
  { raw: "1 (14-ounce) can unsweetened coconut milk (or see cream sauce option below*)", ideal: { quantity: 1, unitName: "can", name: "unsweetened coconut milk", notesContains: ["14", "cream sauce"] } },
  { raw: "1 (28 oz.) can crushed tomatoes", ideal: { quantity: 1, unitName: "can", name: "crushed tomatoes", notesContains: ["28"] } },
  { raw: "1 23-oz. jar marinara, divided", ideal: { quantity: 1, unitName: "jar", name: "marinara", notesContains: ["23", "divided"] } },
  { raw: "1 (16-ounce) package uncooked gnocchi", ideal: { quantity: 1, unitName: "package", name: "uncooked gnocchi", notesContains: ["16"] } },
  { raw: "2 x 400g cans butter beans, drained", ideal: { quantity: 2, unitName: "cans", name: "butter beans", notesContains: ["400", "drained"] } },
  { raw: "4 garlic cloves (grated)", ideal: { quantity: 4, unitName: "cloves", name: "garlic", notesContains: ["grated"] } },
  { raw: "1 clove garlic, minced", ideal: { quantity: 1, unitName: "clove", name: "garlic", notesContains: ["minced"] } },
  { raw: "6 Knoblauchzehen ((fein gehackt))", ideal: { quantity: 6, unitName: "Zehen", name: "Knoblauch", notesContains: ["fein gehackt"] } },

  // ──────────────────────────── Half / Quarter ───────────────────────────
  { raw: "halbe Bio-Orange", ideal: { quantity: 0.5, unitName: null, name: "Bio-Orange" } },
  { raw: "ein halber TL Nelkenpulver", ideal: { quantity: 0.5, unitName: "TL", name: "Nelkenpulver" } },
  { raw: "viertel TL Salz", ideal: { quantity: 0.25, unitName: "TL", name: "Salz" } },
  { raw: "Juice of ½ lemon", ideal: { quantity: 0.5, unitName: null, name: "lemon", notesContains: ["juice"] } },

  // ──────────────────────────── Preparation nouns ────────────────────────
  { raw: "Saft einer halben Zitrone", ideal: { quantity: 0.5, unitName: null, name: "Zitrone", notesContains: ["Saft"] } },
  { raw: "Saft einer halben Zitrone (optional)", ideal: { quantity: 0.5, unitName: null, name: "Zitrone", notesContains: ["Saft"], isOptional: true } },
  { raw: "Saft von 1 Zitrone", ideal: { quantity: 1, unitName: null, name: "Zitrone", notesContains: ["Saft"] } },
  { raw: "Schale von 1 Zitrone", ideal: { quantity: 1, unitName: null, name: "Zitrone", notesContains: ["Schale"] } },
  { raw: "Juice of 1 orange", ideal: { quantity: 1, unitName: null, name: "orange", notesContains: ["juice"] } },
  { raw: "Juice of 1 small lemon", ideal: { quantity: 1, unitName: null, name: "lemon", notesContains: ["juice", "small"] } },
  { raw: "Zest of 1 lemon", ideal: { quantity: 1, unitName: null, name: "lemon", notesContains: ["zest"] } },
  { raw: "Zest of 1 orange", ideal: { quantity: 1, unitName: null, name: "orange", notesContains: ["zest"] } },
  { raw: "Zest of 2 medium lemons", ideal: { quantity: 2, unitName: null, name: "lemons", notesContains: ["zest", "medium"] } },
  // Hard ones: leading prep + compound prep (currently expected to fail or partial).
  { raw: "Abrieb der Schale einer halben Orange", ideal: { quantity: 0.5, unitName: null, name: "Orange", notesContains: ["Abrieb", "Schale"] } },
  { raw: "Saft und etwas abgeriebene Schale von 1 Bio-Zitrone", ideal: { quantity: 1, unitName: null, name: "Bio-Zitrone", notesContains: ["Saft", "Schale"] } },

  // ──────────────────────────── Vague / pinch ────────────────────────────
  { raw: "Eine Prise Salz", ideal: { quantity: 1, unitName: "Prise", name: "Salz" } },
  { raw: "Eine Prise Kurkuma", ideal: { quantity: 1, unitName: "Prise", name: "Kurkuma" } },
  { raw: "Eine Prise schwarzer Pfeffer", ideal: { quantity: 1, unitName: "Prise", name: "Pfeffer", notesContains: ["schwarz"] } },
  { raw: "Pinch of cayenne pepper", ideal: { quantity: 1, unitName: "pinch", name: "cayenne pepper" } },
  { raw: "a pinch freshly grated nutmeg", ideal: { quantity: 1, unitName: "pinch", name: "nutmeg", notesContains: ["freshly grated"] } },
  { raw: "pinch cayenne, optional", ideal: { quantity: 1, unitName: "pinch", name: "cayenne", isOptional: true } },
  { raw: "Big handful mint leaves, chopped", ideal: { quantity: 1, unitName: "handful", name: "mint leaves", notesContains: ["chopped", "big"] } },
  { raw: "1 Handvoll Koriander (optional)", ideal: { quantity: 1, unitName: "Handvoll", name: "Koriander", isOptional: true } },
  { raw: "etwas Apfelsaft", ideal: { quantity: null, unitName: null, name: "Apfelsaft", notesContains: ["etwas"] } },
  { raw: "etwas Knoblauch", ideal: { quantity: null, unitName: null, name: "Knoblauch", notesContains: ["etwas"] } },
  { raw: "etwas fein gehackter Knoblauch", ideal: { quantity: null, unitName: null, name: "Knoblauch", notesContains: ["etwas", "fein gehackt"] } },
  { raw: "etwas geriebener Parmesan", ideal: { quantity: null, unitName: null, name: "Parmesan", notesContains: ["etwas", "gerieben"] } },
  { raw: "etwas Basilikum (frisch)", ideal: { quantity: null, unitName: null, name: "Basilikum", notesContains: ["etwas", "frisch"] } },
  { raw: "etwas Basilikum (optional)", ideal: { quantity: null, unitName: null, name: "Basilikum", notesContains: ["etwas"], isOptional: true } },
  { raw: "etwas Butter für die Form", ideal: { quantity: null, unitName: null, name: "Butter", notesContains: ["etwas", "Form"] } },

  // ──────────────────────────── Size modifiers ───────────────────────────
  { raw: "1 große Karotte (ca. 130-150g)", ideal: { quantity: 1, unitName: null, name: "Karotte", notesContains: ["groß", "130", "150"] } },
  { raw: "1 kleiner Brokkoli", ideal: { quantity: 1, unitName: null, name: "Brokkoli", notesContains: ["klein"] } },
  { raw: "1 kleine Chilischote (gehackt, optional je nach Schärfe der Currypaste)", ideal: { quantity: 1, unitName: null, name: "Chilischote", isOptional: true, notesContains: ["klein", "gehackt", "Schärfe"] } },
  { raw: "1 kleiner TL Orangenabrieb", ideal: { quantity: 1, unitName: "TL", name: "Orangenabrieb", notesContains: ["klein"] } },
  { raw: "5 mittelgroße Apfel", ideal: { quantity: 5, unitName: null, name: "Apfel", notesContains: ["mittelgroß"] } },
  // Slash-separated size alternatives — the tokenizer pads "/" between
  // letters so each adjective reaches the size-modifier loop separately.
  { raw: "1 kleine/mittlere Paprika", ideal: { quantity: 1, unitName: null, name: "Paprika", notesContains: ["klein", "mittler"] } },
  { raw: "kleine/mittlere Paprika", ideal: { quantity: null, unitName: null, name: "Paprika", notesContains: ["klein", "mittler"] } },
  { raw: "3 large eggs", ideal: { quantity: 3, unitName: null, name: "eggs", notesContains: ["large"] } },
  // Real line from the family-wall cache. Tests trailing prep without a
  // comma separator AND leading size descriptor in one pass.
  { raw: "1 large onion chopped", ideal: { quantity: 1, unitName: null, name: "onion", notesContains: ["large", "chopped"] } },
  { raw: "1 onion finely chopped", ideal: { quantity: 1, unitName: null, name: "onion", notesContains: ["finely", "chopped"] } },
  { raw: "1 zucchini, chopped", ideal: { quantity: 1, unitName: null, name: "zucchini", notesContains: ["chopped"] } },
  { raw: "2 red apples (cored and diced)", ideal: { quantity: 2, unitName: null, name: "red apples", notesContains: ["cored", "diced"] } },
  { raw: "1 Spitzkohl (ca. 700 g)", ideal: { quantity: 1, unitName: null, name: "Spitzkohl", notesContains: ["700"] } },
  { raw: "1 rote Zwiebel", ideal: { quantity: 1, unitName: null, name: "rote Zwiebel" } },
  { raw: "½ rote Chilischote", ideal: { quantity: 0.5, unitName: null, name: "rote Chilischote" } },

  // ──────────────────────────── Prep adjectives / participles ────────────
  { raw: "gehackte Petersilie", ideal: { quantity: null, unitName: null, name: "Petersilie", notesContains: ["gehackt"] } },
  { raw: "gemahlener Kreuzkümmel", ideal: { quantity: null, unitName: null, name: "gemahlener Kreuzkümmel" } },
  { raw: "1 EL Zwiebelwürfel, glasig gedünstet", ideal: { quantity: 1, unitName: "EL", name: "Zwiebelwürfel", notesContains: ["glasig gedünstet"] } },

  // ──────────────────────────── Optional markers ─────────────────────────
  // A trailing "*" is footnote noise — ideal drops it cleanly.
  { raw: "1 TL Salz*", ideal: { quantity: 1, unitName: "TL", name: "Salz" } },
  { raw: "Puderzucker (optional zum Bestäuben)", ideal: { quantity: null, unitName: null, name: "Puderzucker", isOptional: true, notesContains: ["Bestäuben"] } },
  { raw: "1 Granatapfelsaft (nach Bedarf)", ideal: { quantity: 1, unitName: null, name: "Granatapfelsaft", notesContains: ["nach Bedarf"] } },
  { raw: "Zucker oder Honig nach Geschmack", ideal: { quantity: null, unitName: null, name: "Zucker", notesContains: ["Honig", "nach geschmack"] } },
  { raw: "150 g veganer Fetakäse (Abtropfgewicht, optional)", ideal: { quantity: 150, unitName: "g", name: "veganer Fetakäse", isOptional: true, notesContains: ["Abtropfgewicht"] } },
  { raw: "1 teaspoon kasuri methi (optional)", ideal: { quantity: 1, unitName: "teaspoon", name: "kasuri methi", isOptional: true } },

  // ──────────────────────────── Name-only / no quantity ──────────────────
  { raw: "Salz", ideal: { quantity: null, unitName: null, name: "Salz" } },
  { raw: "Pfeffer", ideal: { quantity: null, unitName: null, name: "Pfeffer" } },
  { raw: "Schlehen-Punsch", ideal: { quantity: null, unitName: null, name: "Schlehen-Punsch" } },
  { raw: "Pfeffer aus der Mühle, schwarz", ideal: { quantity: null, unitName: null, name: "Pfeffer", notesContains: ["aus der Mühle", "schwarz"] } },

  // ──────────────────────────── Weird / edge cases ───────────────────────
  { raw: "0.2 oz ginger (grated)", ideal: { quantity: 0.2, unitName: "oz", name: "ginger", notesContains: ["grated"] } },
  { raw: "1 ½ pounds sweet potato, diced into ½-inch cubes", ideal: { quantity: 1.5, unitName: "pounds", name: "sweet potato", notesContains: ["diced", "½-inch"] } },
  { raw: "1 Banane ((alternativ 1-2 EL Süßungsmittel nach Wahl, z.B. Dattelpaste))", ideal: { quantity: 1, unitName: null, name: "Banane", notesContains: ["alternativ", "Süßungsmittel"] } },
  { raw: "1 EL Cashewmus (1–2)", ideal: { quantity: 1, unitName: "EL", name: "Cashewmus", notesContains: ["2"] } },
];

describe("familywall golden coverage", () => {
  it("scores parser coverage against LLM-defined ideals (informational)", () => {
    let exact = 0;
    let partial = 0;
    let fail = 0;
    const failures: string[] = [];
    const partials: string[] = [];

    for (const c of CASES) {
      const r = parse(c.raw);
      const verdict = score(c, r);
      if (verdict.kind === "exact") {
        exact += 1;
      } else if (verdict.kind === "partial") {
        partial += 1;
        partials.push(`  ~ ${JSON.stringify(c.raw)}\n    ideal: ${fmt(c.ideal)}\n    got:   ${fmt(r)}\n    diff:  ${verdict.reasons.join("; ")}`);
      } else {
        fail += 1;
        failures.push(`  ✗ ${JSON.stringify(c.raw)}\n    ideal: ${fmt(c.ideal)}\n    got:   ${fmt(r)}\n    diff:  ${verdict.reasons.join("; ")}`);
      }
    }

    const total = CASES.length;
    const lines = [
      "",
      `┌── familywall golden coverage (${total} cases) ──`,
      `│ exact:   ${exact}/${total}  (${pct(exact, total)})`,
      `│ partial: ${partial}/${total}  (${pct(partial, total)})`,
      `│ fail:    ${fail}/${total}  (${pct(fail, total)})`,
      "└────────────────────────────────────────────",
    ];
    if (partials.length > 0) {
      lines.push("", "── partials ──", ...partials);
    }
    if (failures.length > 0) {
      lines.push("", "── failures ──", ...failures);
    }
    console.log(lines.join("\n"));
    // Always passing — purely informational. The assertion below just keeps
    // the test from being silently skipped if a future framework upgrade
    // changes default behaviour.
    expect(CASES.length).toBeGreaterThan(0);
  });
});

type ScoreResult =
  | { kind: "exact" }
  | { kind: "partial"; reasons: string[] }
  | { kind: "fail"; reasons: string[] };

function score(c: Case, r: ParsedShape): ScoreResult {
  // The pipeline already picks the production name/notes (prep-strip,
  // canned-product rule, vocab tails) — there's no separate variant to try.
  return scoreOne(c, r, r.name, r.notes);
}

function scoreOne(
  c: Case,
  r: ParsedShape,
  actualName: string,
  actualNotes: string | null,
): ScoreResult {
  const reasons: string[] = [];

  const qOk = numEq(c.ideal.quantity, r.quantity);
  if (!qOk) reasons.push(`quantity ${c.ideal.quantity} ≠ ${r.quantity}`);
  const nameOk =
    c.ideal.name === undefined || strEq(c.ideal.name, actualName);
  if (!nameOk) reasons.push(`name "${c.ideal.name}" ≠ "${actualName}"`);
  const unitOk =
    c.ideal.unitName === undefined || strEq(c.ideal.unitName, r.unitName);
  if (!unitOk) reasons.push(`unit "${c.ideal.unitName}" ≠ "${r.unitName}"`);
  const optOk =
    c.ideal.isOptional === undefined ||
    c.ideal.isOptional === r.isOptional;
  if (!optOk) reasons.push(`isOptional ${c.ideal.isOptional} ≠ ${r.isOptional}`);

  // Notes — every expected substring must appear (case-insensitive,
  // decimal-separator-agnostic).
  const notes = normalizeDecimals((actualNotes ?? "").toLowerCase());
  const missingNotes = (c.ideal.notesContains ?? []).filter(
    (frag) => !notes.includes(normalizeDecimals(frag.toLowerCase())),
  );
  if (missingNotes.length > 0) {
    reasons.push(
      `notes missing [${missingNotes.map((s) => JSON.stringify(s)).join(", ")}]`,
    );
  }

  if (reasons.length === 0) return { kind: "exact" };
  if (qOk && nameOk) return { kind: "partial", reasons };
  return { kind: "fail", reasons };
}

function normalizeDecimals(s: string): string {
  // Treat decimal "," and "." as the same so "0,5" / "0.5" both match.
  return s.replace(/(\d),(\d)/g, "$1.$2");
}

function numEq(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === undefined) return true;
  if (a === null) return b === null;
  if (b === null || b === undefined) return false;
  return Math.abs(a - b) < 1e-6;
}

function strEq(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) =>
    (s ?? "").toString().trim().toLowerCase();
  return norm(a) === norm(b);
}

function fmt(o: unknown): string {
  return JSON.stringify(o, (_k, v) => (v === undefined ? null : v));
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}
