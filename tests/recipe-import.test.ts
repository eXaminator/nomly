import { describe, it, expect } from "vitest";
import { parseIsoDurationToMinutes } from "@/lib/recipe-import/duration";
import {
  detectSectionHeader,
  normalizeForMatch,
  parseIngredientString,
  splitConjunctions,
} from "@/lib/recipe-import/ingredient";
import {
  asImageUrl,
  asServings,
  asString,
  asStringList,
  extractJsonLdRecipe,
} from "@/lib/recipe-import/json-ld";

describe("parseIsoDurationToMinutes", () => {
  it("parses HMS forms", () => {
    expect(parseIsoDurationToMinutes("PT1H30M")).toBe(90);
    expect(parseIsoDurationToMinutes("PT45M")).toBe(45);
    expect(parseIsoDurationToMinutes("PT2H")).toBe(120);
    expect(parseIsoDurationToMinutes("PT90S")).toBe(2); // rounded
  });
  it("falls back to bare integers", () => {
    expect(parseIsoDurationToMinutes("30")).toBe(30);
    expect(parseIsoDurationToMinutes(45)).toBe(45);
  });
  it("rejects garbage", () => {
    expect(parseIsoDurationToMinutes("foo")).toBeNull();
    expect(parseIsoDurationToMinutes("")).toBeNull();
    expect(parseIsoDurationToMinutes(null)).toBeNull();
    expect(parseIsoDurationToMinutes("PT")).toBeNull();
  });
});

// Test-side stand-in for the DB-derived unit set. Real callers build this
// from `buildUnitLookup().byNameOrAlias.keys()`.
const TEST_UNITS = new Set(
  [
    "g", "kg", "mg", "gramm",
    "ml", "cl", "dl", "l",
    "el", "tl", "esslöffel", "teelöffel",
    "cup", "cups", "tasse", "tassen",
    "tsp", "teaspoon", "teaspoons",
    "tbsp", "tablespoon", "tablespoons",
    "pkg", "pck", "packung", "packungen", "päckchen",
    "dose", "dosen", "can", "cans", "package", "packages",
    "stück", "stk",
    "bund", "bündel", "bunch",
    "handvoll", "handful",
    "prise", "prisen", "pr", "pinch",
    "messerspitze", "msp",
    "zoll", "inch", "inches", '"',
    "cm", "zentimeter", "centimeter", "centimeters",
    "zehe", "zehen", "clove", "cloves",
    "x", "tin", "tins", "bd", "bd.", "stick", "sticks",
  ].map((u) => u.toLowerCase()),
);
const parse = (raw: string) => parseIngredientString(raw, TEST_UNITS);

describe("parseIngredientString", () => {
  it("splits qty + unit + name", () => {
    expect(parse("500 g Hackfleisch")).toEqual({
      quantity: 500,
      unitName: "g",
      name: "Hackfleisch",
      notes: null,
      isOptional: false,
      altWithPrepStripped: null,
    });
  });
  it("separates notes after a comma", () => {
    expect(parse("200 g Speck, gewürfelt")).toEqual({
      quantity: 200,
      unitName: "g",
      name: "Speck",
      notes: "gewürfelt",
      isOptional: false,
      altWithPrepStripped: null,
    });
  });
  it("handles German decimals", () => {
    expect(parse("0,5 l Sahne")).toEqual({
      quantity: 0.5,
      unitName: "l",
      name: "Sahne",
      notes: null,
      isOptional: false,
      altWithPrepStripped: null,
    });
  });
  it("handles fractions", () => {
    const r = parse("1 1/2 Tassen Mehl");
    expect(r.quantity).toBeCloseTo(1.5, 2);
    // "Tassen" is now in the seeded unit list (alias of cup).
    expect(r.unitName?.toLowerCase()).toBe("tassen");
    expect(r.name).toBe("Mehl");
  });
  it("handles unicode fraction glyphs", () => {
    expect(parse("½ TL Salz")).toEqual({
      quantity: 0.5,
      unitName: "TL",
      name: "Salz",
      notes: null,
      isOptional: false,
      altWithPrepStripped: null,
    });
  });
  it("strips leading 'ca.'", () => {
    expect(parse("ca. 300 ml Brühe")).toEqual({
      quantity: 300,
      unitName: "ml",
      name: "Brühe",
      notes: null,
      isOptional: false,
      altWithPrepStripped: null,
    });
  });
  it("uses the max of a range and records the range in notes", () => {
    expect(parse("100-200 g Käse")).toEqual({
      quantity: 200,
      unitName: "g",
      name: "Käse",
      notes: "100-200",
      isOptional: false,
      altWithPrepStripped: null,
    });
  });
  it("range with fractions: max + note", () => {
    const r = parse("1/2-1 cup peanut butter");
    expect(r.quantity).toBe(1);
    expect(r.unitName).toBe("cup");
    expect(r.name).toBe("peanut butter");
    expect(r.notes).toMatch(/0,5-1/);
  });
  it("range across token boundaries: max + note", () => {
    const r = parse("1- 1 1/2 teaspoons sea salt");
    expect(r.quantity).toBe(1.5);
    expect(r.unitName).toBe("teaspoons");
    expect(r.name).toBe("sea salt");
    expect(r.notes).toMatch(/1-1,5/);
  });
  it("leaves unitless ingredients alone", () => {
    expect(parse("3 Eier")).toEqual({
      quantity: 3,
      unitName: null,
      name: "Eier",
      notes: null,
      isOptional: false,
      altWithPrepStripped: null,
    });
  });
  it("treats 'nach Geschmack' as a note", () => {
    expect(parse("Salz nach Geschmack")).toEqual({
      quantity: null,
      unitName: null,
      name: "Salz",
      notes: "nach geschmack",
      isOptional: false,
      altWithPrepStripped: null,
    });
  });
  it("accepts a DB-added alias like 'Pck.' without parser changes", () => {
    expect(parse("1 Pck. Blätterteig")).toEqual({
      quantity: 1,
      unitName: "Pck",
      name: "Blätterteig",
      notes: null,
      isOptional: false,
      altWithPrepStripped: null,
    });
  });
});

describe("parseIngredientString — extended cases", () => {
  it("strips leading + / & / *", () => {
    expect(parse("+ 100 ml Sojasoße").name).toBe("Sojasoße");
    expect(parse("& ½ teaspoon coriander powder").name).toBe("coriander powder");
    expect(parse("*Pfeffer").name).toBe("Pfeffer");
  });
  it("strips stray * anywhere in name", () => {
    expect(parse("100 g *Mehl*").name).toBe("Mehl");
  });
  it("treats [bracketed text] as note", () => {
    const r = parse("200 g Mehl [Type 405]");
    expect(r.name).toBe("Mehl");
    expect(r.notes).toMatch(/Type 405/);
  });
  it("text amount 'Eine Prise Salz' → quantity 1 + unit Prise", () => {
    const r = parse("Eine Prise Salz");
    expect(r.quantity).toBe(1);
    expect(r.unitName?.toLowerCase()).toBe("prise");
    expect(r.name).toBe("Salz");
  });
  it("text amount 'a pinch of nutmeg' → quantity 1 + unit pinch", () => {
    const r = parse("a pinch of nutmeg");
    expect(r.quantity).toBe(1);
    expect(r.unitName?.toLowerCase()).toBe("pinch");
    expect(r.name).toBe("nutmeg");
  });
  it("vague 'Etwas Puderzucker' → no amount, note 'Etwas'", () => {
    const r = parse("Etwas Puderzucker");
    expect(r.quantity).toBeNull();
    expect(r.name).toBe("Puderzucker");
    expect(r.notes?.toLowerCase()).toContain("etwas");
  });
  it("usage suffix 'zum Bestreuen' goes to notes", () => {
    const r = parse("Etwas Puderzucker zum Bestreuen");
    expect(r.name).toBe("Puderzucker");
    expect(r.notes?.toLowerCase()).toContain("zum bestreuen");
  });
  it("dash-separated note 'Flaked Almond - to taste'", () => {
    const r = parse("Flaked Almond - to taste");
    expect(r.name).toBe("Flaked Almond");
    expect(r.notes?.toLowerCase()).toContain("to taste");
  });
  it("amount at the end via colon: 'Flohsamenschalenpulver: 30 g'", () => {
    const r = parse("Flohsamenschalenpulver: 30 g");
    expect(r.quantity).toBe(30);
    expect(r.unitName).toBe("g");
    expect(r.name).toBe("Flohsamenschalenpulver");
  });
  it("unit but no amount falls back to 1", () => {
    const r = parse("Esslöffel Milch");
    expect(r.quantity).toBe(1);
    expect(r.unitName?.toLowerCase()).toBe("esslöffel");
    expect(r.name).toBe("Milch");
  });
  it("'bis 2 EL' → max + note", () => {
    const r = parse("bis 2 EL Honig");
    expect(r.quantity).toBe(2);
    expect(r.unitName?.toLowerCase()).toBe("el");
    expect(r.notes).toMatch(/bis 2/);
  });
  it("' / ' is normalised to 'or' and stays in the name", () => {
    const r = parse("100 g Butter / Margarine");
    expect(r.name).toBe("Butter or Margarine");
  });
  it("' o. ' is normalised to 'or' and stays in the name", () => {
    const r = parse("1 EL Zucker o. Honig");
    expect(r.name).toBe("Zucker or Honig");
  });
  it("'or' alternatives stay in the name", () => {
    const r = parse("6 dried or fresh shiitake mushrooms");
    expect(r.quantity).toBe(6);
    expect(r.name).toBe("dried or fresh shiitake mushrooms");
  });
  it("keeps 'Weizen- oder Dinkelmehl' as one ingredient", () => {
    const r = parse("200 g Weizen- oder Dinkelmehl");
    expect(r.name).toMatch(/Weizen.*oder.*Dinkelmehl/);
  });
  it("inch symbol parses as a unit", () => {
    const r = parse('1" piece ginger');
    expect(r.quantity).toBe(1);
    expect(r.unitName).toBe('"');
    expect(r.name.toLowerCase()).toContain("ginger");
  });
  it("12-count package: compound size in note, package as unit", () => {
    const r = parse("12-count package pull-apart dinner rolls");
    expect(r.quantity).toBe(1);
    expect(r.unitName?.toLowerCase()).toBe("package");
    expect(r.notes).toMatch(/12 count/i);
    expect(r.name).toMatch(/pull-apart/i);
  });
  it("4-inch stems: compound becomes amount+unit when next word is not a container", () => {
    const r = parse("4-inch stems of fresh rosemary");
    expect(r.quantity).toBe(4);
    expect(r.unitName?.toLowerCase()).toBe("inch");
    expect(r.name.toLowerCase()).toContain("rosemary");
  });
  it("parenthesized size 1 (28 oz.) can crushed tomatoes", () => {
    const r = parse("1 (28 oz.) can crushed tomatoes");
    expect(r.quantity).toBe(1);
    expect(r.unitName?.toLowerCase()).toBe("can");
    expect(r.notes).toMatch(/28 oz/i);
    expect(r.name).toMatch(/crushed tomatoes/i);
  });
  it("'to taste' anywhere is captured to notes", () => {
    const r = parse("Black pepper to taste");
    expect(r.name).toBe("Black pepper");
    expect(r.notes?.toLowerCase()).toContain("to taste");
  });
  it("leading filler 'and Salz' is stripped", () => {
    const r = parse("and Salz");
    expect(r.name).toBe("Salz");
  });
  it("'2 + 1/4 cups all-purpose flour' uses + as addition", () => {
    const r = parse("2 + 1/4 cups all-purpose flour");
    expect(r.quantity).toBeCloseTo(2.25, 3);
    expect(r.unitName).toBe("cups");
    expect(r.name).toContain("flour");
  });
  it("'1 & ½ teaspoon coriander powder' uses & as addition", () => {
    const r = parse("1 & ½ teaspoon coriander powder");
    expect(r.quantity).toBeCloseTo(1.5, 3);
    expect(r.unitName).toBe("teaspoon");
    expect(r.name).toContain("coriander");
  });

  it("'halber TL Nelkenpulver' → quantity 0.5", () => {
    const r = parse("halber TL Nelkenpulver");
    expect(r.quantity).toBe(0.5);
    expect(r.unitName).toBe("TL");
    expect(r.name).toBe("Nelkenpulver");
  });
  it("'ein halber TL Nelkenpulver' → quantity 0.5, unit TL", () => {
    const r = parse("ein halber TL Nelkenpulver");
    expect(r.quantity).toBe(0.5);
    expect(r.unitName).toBe("TL");
    expect(r.name).toBe("Nelkenpulver");
  });
  it("'eine halbe Tasse Mehl' → quantity 0.5, unit Tasse", () => {
    const r = parse("eine halbe Tasse Mehl");
    expect(r.quantity).toBe(0.5);
    expect(r.unitName).toBe("Tasse");
    expect(r.name).toBe("Mehl");
  });
  it("'halbe Bio-Orange' → quantity 0.5, no explicit unit, name stripped", () => {
    // No unit token follows "halbe" — the parser leaves unitName null and
    // lets resolveUnit() default to Stück on the integration side.
    const r = parse("halbe Bio-Orange");
    expect(r.quantity).toBe(0.5);
    expect(r.unitName).toBeNull();
    expect(r.name).toBe("Bio-Orange");
  });
  it("'viertel TL Salz' → quantity 0.25, unit TL", () => {
    const r = parse("viertel TL Salz");
    expect(r.quantity).toBe(0.25);
    expect(r.unitName).toBe("TL");
    expect(r.name).toBe("Salz");
  });
  it("'ein viertel TL Salz' → quantity 0.25, unit TL", () => {
    const r = parse("ein viertel TL Salz");
    expect(r.quantity).toBe(0.25);
    expect(r.unitName).toBe("TL");
    expect(r.name).toBe("Salz");
  });
  it("'quarter cup Mehl' → quantity 0.25, unit cup", () => {
    const r = parse("quarter cup Mehl");
    expect(r.quantity).toBe(0.25);
    expect(r.unitName).toBe("cup");
    expect(r.name).toBe("Mehl");
  });
  it("'half a teaspoon Salt' → drops follow-up article", () => {
    const r = parse("half a teaspoon Salt");
    expect(r.quantity).toBe(0.5);
    expect(r.unitName).toBe("teaspoon");
    expect(r.name).toBe("Salt");
  });

  it("'Saft einer halben Zitrone' → 0.5 Zitrone, prep noun moves to notes", () => {
    const r = parse("Saft einer halben Zitrone");
    expect(r.quantity).toBe(0.5);
    expect(r.unitName).toBeNull();
    expect(r.name).toBe("Zitrone");
    expect(r.notes).toBe("Saft");
  });
  it("'Saft einer Zitrone' → 1 Zitrone, prep noun moves to notes", () => {
    const r = parse("Saft einer Zitrone");
    expect(r.quantity).toBe(1);
    expect(r.unitName).toBeNull();
    expect(r.name).toBe("Zitrone");
    expect(r.notes).toBe("Saft");
  });
  it("'Schale von 2 Bio-Orangen' → 2 Bio-Orangen, notes Schale", () => {
    const r = parse("Schale von 2 Bio-Orangen");
    expect(r.quantity).toBe(2);
    expect(r.name).toBe("Bio-Orangen");
    expect(r.notes).toBe("Schale");
  });
  it("'juice of half a lemon' → 0.5 lemon, notes juice", () => {
    const r = parse("juice of half a lemon");
    expect(r.quantity).toBe(0.5);
    expect(r.name).toBe("lemon");
    expect(r.notes).toBe("juice");
  });
  it("'1 large onion chopped' strips leading size + trailing prep via alt", () => {
    const r = parse("1 large onion chopped");
    expect(r.quantity).toBe(1);
    expect(r.altWithPrepStripped).toEqual({
      name: "onion",
      notes: expect.stringMatching(/chopped/),
    });
    expect(r.altWithPrepStripped?.notes).toMatch(/large/);
  });

  it("'200 ml Saft' keeps Saft as the ingredient (no leading prep article)", () => {
    const r = parse("200 ml Saft");
    expect(r.quantity).toBe(200);
    expect(r.unitName).toBe("ml");
    expect(r.name).toBe("Saft");
    expect(r.notes).toBeNull();
  });
  it("'gestrichener TL Zimt' → size modifier 'gestrichen'", () => {
    const r = parse("gestrichener TL Zimt");
    expect(r.unitName).toBe("TL");
    expect(r.name).toBe("Zimt");
    expect(r.notes?.toLowerCase()).toContain("gestrichen");
  });
  it("'geh. TL Salz' → size modifier 'geh.'", () => {
    const r = parse("geh. TL Salz");
    expect(r.unitName).toBe("TL");
    expect(r.name).toBe("Salz");
    expect(r.notes?.toLowerCase()).toContain("geh");
  });
  it("'je ½ TL Zucker' → 'je' stripped, quantity 0.5", () => {
    const r = parse("je ½ TL Zucker");
    expect(r.quantity).toBe(0.5);
    expect(r.unitName).toBe("TL");
    expect(r.name).toBe("Zucker");
  });
  it("'opt. 2 EL Erdnüsse' → marked optional, 'opt.' stripped", () => {
    const r = parse("opt. 2 EL Erdnüsse");
    expect(r.quantity).toBe(2);
    expect(r.unitName).toBe("EL");
    expect(r.name).toBe("Erdnüsse");
    expect(r.isOptional).toBe(true);
  });
  it("'Optional: 2 EL Sesamsaat' → marked optional, name parsed", () => {
    const r = parse("Optional: 2 EL Sesamsaat");
    expect(r.quantity).toBe(2);
    expect(r.unitName).toBe("EL");
    expect(r.name).toBe("Sesamsaat");
    expect(r.isOptional).toBe(true);
  });
  it("'Nach Belieben 1 Eigelb' → marked optional, name parsed", () => {
    const r = parse("Nach Belieben 1 Eigelb");
    expect(r.quantity).toBe(1);
    expect(r.name).toBe("Eigelb");
    expect(r.isOptional).toBe(true);
  });
  it("inline '(optional)' marker → optional flag set", () => {
    const r = parse("1 EL Honig (optional)");
    expect(r.quantity).toBe(1);
    expect(r.name).toBe("Honig");
    expect(r.isOptional).toBe(true);
  });
  it("trailing ', optional' marker → optional flag set", () => {
    const r = parse("1 EL Honig, optional");
    expect(r.quantity).toBe(1);
    expect(r.name).toBe("Honig");
    expect(r.isOptional).toBe(true);
  });
  it("non-optional rows have isOptional=false", () => {
    expect(parse("100 g Mehl").isOptional).toBe(false);
  });
  it("'5 cm piece ginger' parses with cm unit", () => {
    const r = parse("5 cm piece ginger finely grated");
    expect(r.quantity).toBe(5);
    expect(r.unitName?.toLowerCase()).toBe("cm");
    expect(r.name.toLowerCase()).toContain("ginger");
  });
  it("'2 Zehen Knoblauch' parses with Zehen unit", () => {
    const r = parse("2 Zehen Knoblauch");
    expect(r.quantity).toBe(2);
    expect(r.unitName?.toLowerCase()).toBe("zehen");
    expect(r.name).toBe("Knoblauch");
  });

  it("offers prep-stripped alternative for '2 chopped tomatoes'", () => {
    const r = parse("2 chopped tomatoes");
    expect(r.quantity).toBe(2);
    expect(r.name).toBe("chopped tomatoes");
    expect(r.altWithPrepStripped).not.toBeNull();
    expect(r.altWithPrepStripped?.name).toBe("tomatoes");
    expect(r.altWithPrepStripped?.notes?.toLowerCase()).toContain("chopped");
  });
  it("offers prep-stripped alt for German 'gehackt' + adverb", () => {
    const r = parse("200 g fein gehackt Petersilie");
    expect(r.altWithPrepStripped?.name).toBe("Petersilie");
    expect(r.altWithPrepStripped?.notes?.toLowerCase()).toContain("fein gehackt");
  });
  it("no alt for '2 ripe tomatoes' (ripe is not a prep word)", () => {
    const r = parse("2 ripe tomatoes");
    expect(r.altWithPrepStripped).toBeNull();
  });

  it("strips soft hyphens from the name", () => {
    const r = parse("100 g Thy­mi­an");
    expect(r.name).toBe("Thymian");
  });
  it("strips leading bullet emoji '▢'", () => {
    const r = parse("▢1 teaspoon ground cinnamon");
    expect(r.quantity).toBe(1);
    expect(r.unitName).toBe("teaspoon");
    expect(r.name.toLowerCase()).toContain("cinnamon");
  });
  it("treats '~ 2 EL' as quantity 2", () => {
    const r = parse("~ 2 EL Honig");
    expect(r.quantity).toBe(2);
    expect(r.unitName).toBe("EL");
    expect(r.name).toBe("Honig");
  });
  it("'plus 1 teaspoon brown sugar' drops the 'plus'", () => {
    const r = parse("plus 1 teaspoon brown sugar");
    expect(r.quantity).toBe(1);
    expect(r.unitName).toBe("teaspoon");
    expect(r.name).toBe("brown sugar");
  });
  it("'to ½ teaspoon red pepper flakes' drops the 'to'", () => {
    const r = parse("to ½ teaspoon red pepper flakes");
    expect(r.quantity).toBe(0.5);
    expect(r.unitName).toBe("teaspoon");
    expect(r.name).toBe("red pepper flakes");
  });
  it("'bell pepper- thinly sliced' splits the dash into a note", () => {
    const r = parse("1 bell pepper- thinly sliced");
    expect(r.quantity).toBe(1);
    expect(r.name.toLowerCase()).toContain("bell pepper");
    expect(r.notes?.toLowerCase()).toContain("thinly sliced");
  });
  it("'optional' anywhere sets the flag and is stripped", () => {
    const r = parse("100 g Zucker (optional, fein)");
    expect(r.isOptional).toBe(true);
    expect(r.name).toBe("Zucker");
    expect((r.notes ?? "").toLowerCase()).not.toContain("optional");
  });
  it("'n. B.' marker sets optional", () => {
    const r = parse("Salz n. B.");
    expect(r.isOptional).toBe(true);
    expect(r.name).toBe("Salz");
  });
  it("range with repeated unit '25 g – 50 g' uses max + note", () => {
    const r = parse("25 g – 50 g gekühlte Marzipan-Rohmasse");
    expect(r.quantity).toBe(50);
    expect(r.unitName).toBe("g");
    expect(r.notes).toMatch(/25-50/);
  });
  it("'1 garlic clove' parses unit from the trailing token", () => {
    const r = parse("1 garlic clove");
    expect(r.quantity).toBe(1);
    expect(r.unitName?.toLowerCase()).toBe("clove");
    expect(r.name).toBe("garlic");
  });
  it("'1x Knoblauchzehe' parses 'x' as Stück alias", () => {
    const r = parse("1x Knoblauchzehe");
    expect(r.quantity).toBe(1);
    expect(r.unitName?.toLowerCase()).toBe("x");
    expect(r.name).toBe("Knoblauchzehe");
  });
  it("'1 tin chopped tomatoes' parses tin as Dose alias", () => {
    const r = parse("1 tin chopped tomatoes");
    expect(r.quantity).toBe(1);
    expect(r.unitName?.toLowerCase()).toBe("tin");
    expect(r.name.toLowerCase()).toContain("tomatoes");
  });
  it("'Stk. Ingwer' falls back to amount 1 with Stk. as unit", () => {
    const r = parse("Stk. Ingwer");
    expect(r.quantity).toBe(1);
    expect(r.unitName?.toLowerCase()).toBe("stk");
    expect(r.name).toBe("Ingwer");
  });

  it("'4 to 6 cups chicken stock' uses max + range note", () => {
    const r = parse("4 to 6 cups chicken stock");
    expect(r.quantity).toBe(6);
    expect(r.unitName).toBe("cups");
    expect(r.name).toBe("chicken stock");
    expect(r.notes).toMatch(/4-6/);
  });
  it("'1 bis 2 EL Milch' uses max + range note", () => {
    const r = parse("1 bis 2 EL Milch");
    expect(r.quantity).toBe(2);
    expect(r.unitName).toBe("EL");
    expect(r.name).toBe("Milch");
    expect(r.notes).toMatch(/1-2/);
  });
  it("'Heaping 1 teaspoon sea salt' peels modifier before quantity", () => {
    const r = parse("Heaping 1 teaspoon sea salt");
    expect(r.quantity).toBe(1);
    expect(r.unitName).toBe("teaspoon");
    expect(r.name).toBe("sea salt");
    expect(r.notes?.toLowerCase()).toContain("heaping");
  });
  it("'½ cup 1 stick unsalted butter' peels secondary qty+unit to notes", () => {
    const r = parse("½ cup 1 stick unsalted butter, room temperature");
    expect(r.quantity).toBe(0.5);
    expect(r.unitName).toBe("cup");
    expect(r.name).toBe("unsalted butter");
    expect(r.notes).toMatch(/1 stick/);
    expect(r.notes?.toLowerCase()).toContain("room temperature");
  });
  it("'1½ tsp. plus ¼ cup cornstarch, divided' moves '¼ cup' to notes", () => {
    const r = parse("1½ tsp. plus ¼ cup cornstarch, divided");
    expect(r.quantity).toBeCloseTo(1.5, 3);
    expect(r.unitName).toBe("tsp");
    expect(r.name).toBe("cornstarch");
    expect(r.notes).toMatch(/¼ cup/);
    expect(r.notes?.toLowerCase()).toContain("divided");
  });

  it("parser returns empty name for '2 Prise' alone", () => {
    const r = parse("2 Prise");
    expect(r.quantity).toBe(2);
    expect(r.unitName).toBe("Prise");
    expect(r.name).toBe("");
  });
  it("parser returns empty name for '200 g' alone", () => {
    const r = parse("200 g");
    expect(r.quantity).toBe(200);
    expect(r.unitName).toBe("g");
    expect(r.name).toBe("");
  });
});

describe("detectSectionHeader", () => {
  it("returns null for normal ingredient lines", () => {
    expect(detectSectionHeader("200 g Mehl")).toBeNull();
    expect(detectSectionHeader("Salz")).toBeNull();
  });
  it("detects trailing colon", () => {
    expect(detectSectionHeader("Für den Teig:")).toBe("Für den Teig");
  });
  it("detects all-caps", () => {
    expect(detectSectionHeader("FÜR DEN GRANATAPFELGUSS")).toBe(
      "FÜR DEN GRANATAPFELGUSS",
    );
  });
  it("detects leading 2+ dashes", () => {
    expect(detectSectionHeader("--- For the sauce ---")).toBe("For the sauce");
    expect(detectSectionHeader("-- Teig")).toBe("Teig");
  });
  it("detects leading emoji", () => {
    expect(detectSectionHeader("🥖 For the bread")).toBe("For the bread");
  });
  it("ignores single-dash bullet", () => {
    expect(detectSectionHeader("- 100 g Mehl")).toBeNull();
  });
  it("'Part 2: Sauce' → 'Sauce'", () => {
    expect(detectSectionHeader("Part 2: Sauce")).toBe("Sauce");
  });
  it("'Teil 1: Teig' → 'Teig'", () => {
    expect(detectSectionHeader("Teil 1: Teig")).toBe("Teig");
  });
});

describe("splitConjunctions", () => {
  it("does nothing for a normal line", () => {
    expect(splitConjunctions("200 g Mehl")).toEqual(["200 g Mehl"]);
  });
  it("splits on ' und '", () => {
    expect(splitConjunctions("Salz und Pfeffer")).toEqual(["Salz", "Pfeffer"]);
  });
  it("splits on ' & '", () => {
    expect(splitConjunctions("Salz & Pfeffer")).toEqual(["Salz", "Pfeffer"]);
  });
  it("splits on ' and '", () => {
    expect(splitConjunctions("Salt and Pepper")).toEqual(["Salt", "Pepper"]);
  });
  it("keeps 'yellow and red grape tomatoes' as one ingredient (color + color)", () => {
    // Regression: family-wall "Chickpea Salad" recipe had this line and
    // we were splitting into "2 cups mixed yellow" + "red grape tomatoes",
    // producing a phantom "yellow" ingredient.
    expect(
      splitConjunctions(
        "2 cups mixed yellow and red grape tomatoes (halved)",
      ),
    ).toEqual(["2 cups mixed yellow and red grape tomatoes (halved)"]);
  });
  it("keeps 'gelbe und rote Paprika' as one ingredient", () => {
    expect(splitConjunctions("gelbe und rote Paprika")).toEqual([
      "gelbe und rote Paprika",
    ]);
  });
  it("still splits when the conjunction sits between real ingredients", () => {
    expect(splitConjunctions("yogurt and milk")).toEqual(["yogurt", "milk"]);
  });
  it("keeps 'Weizen- oder Dinkelmehl' as one ingredient", () => {
    expect(splitConjunctions("Weizen- und Dinkelmehl")).toEqual([
      "Weizen- und Dinkelmehl",
    ]);
  });
  it("does not split inside parentheses", () => {
    expect(
      splitConjunctions("1 medium onion (½ finely chopped & ½ sliced)"),
    ).toEqual(["1 medium onion (½ finely chopped & ½ sliced)"]);
  });
  it("does not split inside brackets", () => {
    expect(splitConjunctions("Salz [Meersalz und Steinsalz]")).toEqual([
      "Salz [Meersalz und Steinsalz]",
    ]);
  });
  it("does not split before a cooking-prep verb", () => {
    expect(
      splitConjunctions(
        "1 pound Persian cucumbers, halved lengthwise and cut into 1/2-inch pieces",
      ),
    ).toEqual([
      "1 pound Persian cucumbers, halved lengthwise and cut into 1/2-inch pieces",
    ]);
  });
});

describe("normalizeForMatch", () => {
  it("removes diacritics and lowercases", () => {
    expect(normalizeForMatch("Möhre")).toBe("mohre");
    expect(normalizeForMatch("möhre")).toBe("mohre");
    expect(normalizeForMatch("Tomate")).toBe("tomate");
    expect(normalizeForMatch("Soße")).toBe("sosse");
    expect(normalizeForMatch("ÄPFEL")).toBe("apfel");
  });
});

describe("extractJsonLdRecipe", () => {
  it("finds a top-level Recipe", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(
      { "@context": "https://schema.org", "@type": "Recipe", name: "Test" },
    )}</script></head><body /></html>`;
    const r = extractJsonLdRecipe(html);
    expect(r?.name).toBe("Test");
  });
  it("finds a Recipe inside @graph", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", name: "page" },
        { "@type": "Recipe", name: "Inside Graph" },
      ],
    })}</script>`;
    expect(extractJsonLdRecipe(html)?.name).toBe("Inside Graph");
  });
  it("returns null when no Recipe is present", () => {
    const html = `<script type="application/ld+json">{"@type":"WebPage"}</script>`;
    expect(extractJsonLdRecipe(html)).toBeNull();
  });
  it("survives non-JSON script bodies", () => {
    const html = `<script type="application/ld+json">not json</script><script type="application/ld+json">${JSON.stringify(
      { "@type": "Recipe", name: "ok" },
    )}</script>`;
    expect(extractJsonLdRecipe(html)?.name).toBe("ok");
  });
});

describe("JSON-LD field coercion", () => {
  it("extracts strings from arrays", () => {
    expect(asString(["A", "B"])).toBe("A");
    expect(asString("hi")).toBe("hi");
    expect(asString(null)).toBeNull();
    expect(asString("  ")).toBeNull();
  });
  it("flattens recipeInstructions variants", () => {
    expect(asStringList(["A", "B"])).toEqual(["A", "B"]);
    expect(
      asStringList([
        { "@type": "HowToStep", text: "Mix" },
        { "@type": "HowToStep", text: "Bake" },
      ]),
    ).toEqual(["Mix", "Bake"]);
    expect(
      asStringList([
        {
          "@type": "HowToSection",
          itemListElement: [
            { "@type": "HowToStep", text: "First" },
            { "@type": "HowToStep", text: "Then" },
          ],
        },
      ]),
    ).toEqual(["First", "Then"]);
  });
  it("extracts an image URL", () => {
    expect(asImageUrl("https://x/img.jpg")).toBe("https://x/img.jpg");
    expect(
      asImageUrl({ "@type": "ImageObject", url: "https://y/img.jpg" }),
    ).toBe("https://y/img.jpg");
    expect(asImageUrl(["https://a", "https://b"])).toBe("https://a");
    expect(asImageUrl(null)).toBeNull();
  });
  it("extracts servings", () => {
    expect(asServings(4)).toBe(4);
    expect(asServings("4 Portionen")).toBe(4);
    expect(asServings(["6"])).toBe(6);
    expect(asServings("none")).toBe(1);
  });
});
