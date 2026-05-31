import { describe, it, expect } from "vitest";
import {
  disambiguateFamilywallNames,
  promoteFamilywallSectionHeaders,
  rewriteFamilywallAppleVarieties,
  rewriteFamilywallPersonalLabels,
  transformFamilywallRecipe,
} from "@/lib/familywall/transform";
import type {
  IngredientLookup,
  ParseLookups,
  UnitLookup,
} from "@/lib/recipe-import/index";
import type { FamilywallRawRecipe } from "@/lib/familywall/types";

function makeLookups(): ParseLookups {
  const units: UnitLookup = {
    byNameOrAlias: new Map([
      ["g", { id: 1, name: "g", isContainer: false }],
      ["el", { id: 2, name: "EL", isContainer: false }],
      ["tablespoon", { id: 2, name: "EL", isContainer: false }],
      ["stück", { id: 3, name: "Stück", isContainer: false }],
      ["cup", { id: 4, name: "Cup", isContainer: false }],
    ]),
    byCanonicalName: new Map([
      ["g", { id: 1, name: "g", isContainer: false }],
      ["el", { id: 2, name: "EL", isContainer: false }],
      ["stück", { id: 3, name: "Stück", isContainer: false }],
      ["cup", { id: 4, name: "Cup", isContainer: false }],
    ]),
    containerTokens: new Set(),
  };
  const ingredients: IngredientLookup = new Map([
    ["mehl", { id: 10, canonicalName: "Mehl" }],
    ["zwiebel", { id: 11, canonicalName: "Zwiebel" }],
    ["onion", { id: 11, canonicalName: "Zwiebel" }],
  ]);
  return { units, ingredients };
}

function makeRaw(over: Partial<FamilywallRawRecipe> = {}): FamilywallRawRecipe {
  return {
    title: "Bolognese",
    description: null,
    servings: 4,
    prepTimeMin: 15,
    cookTimeMin: 90,
    ingredients: ["500 g Hackfleisch"],
    instructions: ["Anbraten.", "Schmoren."],
    sourceUrl: null,
    imageUrl: null,
    isFavorite: false,
    tags: [],
    ...over,
  };
}

describe("transformFamilywallRecipe", () => {
  it("happy path: title, servings, times, ingredient + instructions", () => {
    const out = transformFamilywallRecipe(makeRaw(), makeLookups(), null);
    expect(out.title).toBe("Bolognese");
    expect(out.servings).toBe(4);
    expect(out.prepTimeMin).toBe(15);
    expect(out.cookTimeMin).toBe(90);
    expect(out.photoPath).toBeNull();
    expect(out.sourceUrl).toBeNull();
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].instructions).toBe("1. Anbraten.\n2. Schmoren.");
    expect(out.sections[0].ingredients[0]).toEqual({
      ingredientName: "Hackfleisch",
      // No catalog hit for "Hackfleisch" in the test lookup → ingredientId
      // stays null and the server will create the row by name on save.
      ingredientId: null,
      quantity: 500,
      unitId: 1, // g
      displayUnit: null,
      notes: null,
      isOptional: false,
      fixedAmount: false,
      rawLine: "500 g Hackfleisch",
      isAlternative: false,
    });
  });

  it("threads the matcher's resolved ingredientId through to the save payload", () => {
    // Regression guard: when the matcher picks an existing catalog entry,
    // transform.ts must surface its ingredientId on the payload. Without
    // this, the displayName-preservation change from Phase A degrades into
    // duplicate canonicals because `service.resolveIngredient` falls back
    // to looking up by the (un-canonical) display name.
    const lookups = makeLookups();
    // Seed the catalog with Paprikapulver canonical so the matcher can hit.
    lookups.ingredients.set("paprikapulver", {
      id: 99,
      canonicalName: "Paprikapulver",
    });
    lookups.ingredientCatalog = [
      {
        ingredientId: 99,
        canonicalName: "Paprikapulver",
        aliasName: "Paprikapulver",
        tokens: ["paprikapulver"],
      },
    ];
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: ["1 g Paprika-Pulver"] }),
      lookups,
      null,
    );
    const ing = out.sections[0].ingredients[0];
    // displayName is the matched alias (the canonical "Paprikapulver"), and the
    // row is pinned to that existing ingredient id.
    expect(ing.ingredientName).toBe("Paprikapulver");
    expect(ing.ingredientId).toBe(99);
  });

  it("missing servings → defaults to 1", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ servings: null }),
      makeLookups(),
      null,
    );
    expect(out.servings).toBe(1);
  });

  it("passes through photoPath when the orchestrator supplied one", () => {
    const out = transformFamilywallRecipe(
      makeRaw(),
      makeLookups(),
      "photos/abc.webp",
    );
    expect(out.photoPath).toBe("photos/abc.webp");
  });

  it("preserves original source URL but ONLY that", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ sourceUrl: "https://chefkoch.de/foo" }),
      makeLookups(),
      null,
    );
    expect(out.sourceUrl).toBe("https://chefkoch.de/foo");
  });

  it("parser leaves unknown unit tokens in the name (Stück default kicks in)", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: ["1 schmunzel Salz"] }),
      makeLookups(),
      null,
    );
    const ing = out.sections[0].ingredients[0];
    // The conservative parser doesn't recognise "schmunzel" as a unit, so
    // "schmunzel Salz" becomes the ingredient name and the row falls back
    // to the Stück default (since we have a positive quantity).
    expect(ing.ingredientName).toBe("schmunzel Salz");
    expect(ing.unitId).toBe(3); // Stück fallback
    expect(ing.notes).toBeNull();
  });

  it("'halbe Bio-Orange' → 0.5 Stück Bio-Orange (Stück default kicks in)", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: ["halbe Bio-Orange"] }),
      makeLookups(),
      null,
    );
    const ing = out.sections[0].ingredients[0];
    expect(ing.quantity).toBe(0.5);
    expect(ing.unitId).toBe(3); // Stück
    expect(ing.ingredientName).toBe("Bio-Orange");
  });

  it("english unit token resolves via the alias lookup", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: ["2 tablespoon Olivenöl"] }),
      makeLookups(),
      null,
    );
    const ing = out.sections[0].ingredients[0];
    expect(ing.unitId).toBe(2); // EL
    expect(ing.quantity).toBe(2);
    expect(ing.ingredientName).toBe("Olivenöl");
  });

  it("defaults to Stück for an unitless qty", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: ["3 Eier"] }),
      makeLookups(),
      null,
    );
    const ing = out.sections[0].ingredients[0];
    expect(ing.unitId).toBe(3); // Stück
    expect(ing.quantity).toBe(3);
    expect(ing.ingredientName).toBe("Eier");
  });

  it("promotes familywall-only section keywords (Teig, Füllung, …) into headers", () => {
    const out = transformFamilywallRecipe(
      makeRaw({
        ingredients: [
          "Teig",
          "200 g Mehl",
          "Füllung",
          "1 Zwiebel",
        ],
      }),
      makeLookups(),
      null,
    );
    expect(out.sections).toHaveLength(2);
    expect(out.sections[0].title).toBe("Teig");
    expect(out.sections[0].ingredients).toHaveLength(1);
    expect(out.sections[0].ingredients[0].ingredientName).toBe("Mehl");
    expect(out.sections[1].title).toBe("Füllung");
    expect(out.sections[1].ingredients).toHaveLength(1);
    expect(out.sections[1].ingredients[0].ingredientName).toBe("Zwiebel");
  });

  it("promotes lowercase 'für den X' headers without a trailing colon", () => {
    const out = transformFamilywallRecipe(
      makeRaw({
        ingredients: ["für den Teig", "200 g Mehl", "Für die Füllung:", "1 Zwiebel"],
      }),
      makeLookups(),
      null,
    );
    expect(out.sections.map((s) => s.title)).toEqual([
      "für den Teig",
      "Für die Füllung",
    ]);
  });

  it("empty title falls back to a placeholder", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ title: "   " }),
      makeLookups(),
      null,
    );
    expect(out.title).toBe("Importiertes Rezept");
  });

  it("single instruction step still renders as a numbered list", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ instructions: ["Nur ein Schritt."] }),
      makeLookups(),
      null,
    );
    expect(out.sections[0].instructions).toBe("1. Nur ein Schritt.");
  });

  it("normalises whitespace inside each step", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ instructions: ["  Anbraten.\n  Schmoren.  ", "Servieren."] }),
      makeLookups(),
      null,
    );
    expect(out.sections[0].instructions).toBe(
      "1. Anbraten. Schmoren.\n2. Servieren.",
    );
  });

  it("isFavorite adds the Familywall-Favorit tag", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ isFavorite: true }),
      makeLookups(),
      null,
    );
    expect(out.tags).toEqual(["Familywall-Favorit"]);
  });

  it("category tags from the raw recipe are forwarded", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ tags: ["Reis", "Vegan"], isFavorite: true }),
      makeLookups(),
      null,
    );
    expect(out.tags).toEqual(["Reis", "Vegan", "Familywall-Favorit"]);
  });

  it("dedupes tags case-insensitively", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ tags: ["Vegan", "vegan", " Vegan "] }),
      makeLookups(),
      null,
    );
    expect(out.tags).toEqual(["Vegan"]);
  });

  it("parses '500g' (no space) as a quantity + unit", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: ["500g Mehl"] }),
      makeLookups(),
      null,
    );
    const ing = out.sections[0].ingredients[0];
    expect(ing.quantity).toBe(500);
    expect(ing.unitId).toBe(1); // g
    expect(ing.ingredientName).toBe("Mehl");
  });

  it("parses '.5 cup' as quantity 0.5 + cup", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: [".5 cup Mehl"] }),
      makeLookups(),
      null,
    );
    const ing = out.sections[0].ingredients[0];
    expect(ing.quantity).toBe(0.5);
    expect(ing.unitId).toBe(4); // Cup
    expect(ing.ingredientName).toBe("Mehl");
  });

  it("strips pseudo-plural '(n)' from ingredient names", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: ["6 Tomate(n)"] }),
      makeLookups(),
      null,
    );
    const ing = out.sections[0].ingredients[0];
    expect(ing.ingredientName).toBe("Tomate");
    expect(ing.quantity).toBe(6);
  });

  it("strips pseudo-plural '/n' from a Familywall unit marker", () => {
    const lookups = makeLookups();
    lookups.units.byNameOrAlias.set("dose", { id: 6, name: "Dose", isContainer: false });
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: ["1 Dose/n Kidneybohnen"] }),
      lookups,
      null,
    );
    const ing = out.sections[0].ingredients[0];
    expect(ing.quantity).toBe(1);
    expect(ing.unitId).toBe(6); // Dose
    expect(ing.ingredientName).toBe("Kidneybohnen");
  });

  it("captures parenthesised content anywhere as notes", () => {
    const lookups = makeLookups();
    lookups.units.byNameOrAlias.set("dose", { id: 6, name: "Dose", isContainer: false });
    const out = transformFamilywallRecipe(
      makeRaw({
        ingredients: ["1 Dose Kidneybohnen (Abtropfgewicht ca. 255 g)"],
      }),
      lookups,
      null,
    );
    const ing = out.sections[0].ingredients[0];
    expect(ing.ingredientName).toBe("Kidneybohnen");
    expect(ing.notes).toBe("Abtropfgewicht ca. 255 g");
  });

  it("strips existing step numbering before re-numbering", () => {
    const out = transformFamilywallRecipe(
      makeRaw({
        instructions: [
          "1. Heat the oil.",
          "2) Add onions.",
          "Step 3: Stir well.",
          "Schritt 4. Servieren.",
        ],
      }),
      makeLookups(),
      null,
    );
    expect(out.sections[0].instructions).toBe(
      "1. Heat the oil.\n2. Add onions.\n3. Stir well.\n4. Servieren.",
    );
  });

  it("doesn't strip content that just happens to start with a digit", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ instructions: ["1.5 cups of broth, simmer 10 minutes."] }),
      makeLookups(),
      null,
    );
    expect(out.sections[0].instructions).toBe(
      "1. 1.5 cups of broth, simmer 10 minutes.",
    );
  });

  it("parses 'Pck.' as a Packung unit token", () => {
    const lookups = makeLookups();
    lookups.units.byNameOrAlias.set("pck", { id: 8, name: "Packung", isContainer: false });
    const out = transformFamilywallRecipe(
      makeRaw({
        ingredients: ["1 Pck. Blätterteig (Blätterteig-Rolle, TK)"],
      }),
      lookups,
      null,
    );
    const ing = out.sections[0].ingredients[0];
    expect(ing.quantity).toBe(1);
    expect(ing.unitId).toBe(8); // Packung
    expect(ing.ingredientName).toBe("Blätterteig");
    expect(ing.notes).toBe("Blätterteig-Rolle, TK");
  });

  it("recognises 'Dose' after a size modifier 'kl.'", () => {
    const lookups = makeLookups();
    lookups.units.byNameOrAlias.set("dose", { id: 6, name: "Dose", isContainer: false });
    const out = transformFamilywallRecipe(
      makeRaw({
        ingredients: ["1 kl. Dose Kidneybohnen (Abtropfgewicht ca. 255 g)"],
      }),
      lookups,
      null,
    );
    const ing = out.sections[0].ingredients[0];
    expect(ing.quantity).toBe(1);
    expect(ing.unitId).toBe(6); // Dose
    expect(ing.ingredientName).toBe("Kidneybohnen");
    // Size hint + paren-content both preserved in notes
    expect(ing.notes).toBe("kl., Abtropfgewicht ca. 255 g");
  });

  it("strips unbalanced trailing parens defensively", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: ["3 Tomate, gewürfelt)"] }),
      makeLookups(),
      null,
    );
    const ing = out.sections[0].ingredients[0];
    expect(ing.notes).toBe("gewürfelt");
    expect(ing.ingredientName).toBe("Tomate");
  });

  it("drops 'of' filler between unit and name", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: ["100g of caster sugar"] }),
      makeLookups(),
      null,
    );
    const ing = out.sections[0].ingredients[0];
    expect(ing.quantity).toBe(100);
    expect(ing.unitId).toBe(1); // g
    expect(ing.ingredientName).toBe("caster sugar");
  });

  it("'oder'-alternatives split into primary + optional alternative row", () => {
    // "Butter oder Margarine" becomes Butter (primary) + Margarine
    // (alternative, isOptional + isAlternative both true). The downstream
    // service layer links the alternative to the primary via
    // recipe_ingredient.alternative_for_id at insert time.
    // Both ingredients are seeded into the catalog so the matcher picks
    // them up — otherwise the unmatched-alternative fold-back path absorbs
    // Margarine into Butter's notes (covered separately).
    const lookups = makeLookups();
    lookups.ingredients.set("butter", { id: 20, canonicalName: "Butter" });
    lookups.ingredients.set("margarine", { id: 21, canonicalName: "Margarine" });
    lookups.ingredientCatalog = [
      { ingredientId: 20, canonicalName: "Butter", aliasName: "Butter", tokens: ["butter"] },
      { ingredientId: 21, canonicalName: "Margarine", aliasName: "Margarine", tokens: ["margarine"] },
    ];
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: ["100g Butter oder Margarine"] }),
      lookups,
      null,
    );
    const rows = out.sections[0].ingredients;
    expect(rows).toHaveLength(2);
    expect(rows[0].ingredientName).toBe("Butter");
    expect(rows[0].isOptional).toBe(false);
    expect(rows[1].ingredientName).toBe("Margarine");
    expect(rows[1].isOptional).toBe(true);
    expect(rows[1].isAlternative).toBe(true);
  });

  it("moves 'z.B.' examples into notes", () => {
    const lookups = makeLookups();
    lookups.units.byNameOrAlias.set("tl", { id: 7, name: "TL", isContainer: false });
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: ["1 TL Salz z.B. Meersalz"] }),
      lookups,
      null,
    );
    const ing = out.sections[0].ingredients[0];
    expect(ing.quantity).toBe(1);
    expect(ing.unitId).toBe(7); // TL
    expect(ing.ingredientName).toBe("Salz");
    expect(ing.notes).toBe("z.B. Meersalz");
  });

  it("recovers a spaced decimal '0, 5'", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: ["0, 5 g Senf"] }),
      makeLookups(),
      null,
    );
    const ing = out.sections[0].ingredients[0];
    expect(ing.quantity).toBe(0.5);
    expect(ing.unitId).toBe(1); // g
    expect(ing.ingredientName).toBe("Senf");
  });

  it("splits ingredients at ALL-CAPS section headings", () => {
    const out = transformFamilywallRecipe(
      makeRaw({
        ingredients: [
          "PASTRY",
          "200g Mehl",
          "100g Butter",
          "FILLING",
          "3 Eier",
        ],
      }),
      makeLookups(),
      null,
    );
    expect(out.sections).toHaveLength(2);
    expect(out.sections[0].title).toBe("Pastry");
    expect(out.sections[0].ingredients.map((i) => i.ingredientName)).toEqual([
      "Mehl",
      "Butter",
    ]);
    expect(out.sections[1].title).toBe("Filling");
    expect(out.sections[1].ingredients.map((i) => i.ingredientName)).toEqual([
      "Eier",
    ]);
    // Instructions stay on the first section
    expect(out.sections[0].instructions).toBe("1. Anbraten.\n2. Schmoren.");
    expect(out.sections[1].instructions).toBe("");
  });

  it("uses first-line heading as the first section's title", () => {
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: ["DOUGH", "200g Mehl"] }),
      makeLookups(),
      null,
    );
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].title).toBe("Dough");
    expect(out.sections[0].ingredients).toHaveLength(1);
  });

  it("parses '1½tsp' as quantity 1.5 + tsp", () => {
    const lookups = makeLookups();
    lookups.units.byNameOrAlias.set("tsp", { id: 5, name: "TL", isContainer: false });
    lookups.units.byNameOrAlias.set("teaspoon", { id: 5, name: "TL", isContainer: false });
    const out = transformFamilywallRecipe(
      makeRaw({ ingredients: ["1½tsp Salz"] }),
      lookups,
      null,
    );
    const ing = out.sections[0].ingredients[0];
    expect(ing.quantity).toBe(1.5);
    expect(ing.unitId).toBe(5); // TL
    expect(ing.ingredientName).toBe("Salz");
  });

  it("matches instruction sections to ingredient sections by title", () => {
    const out = transformFamilywallRecipe(
      makeRaw({
        ingredients: [
          "Für den Teig:",
          "200 g Mehl",
          "1 EL Zucker",
          "Für die Füllung:",
          "100 g Quark",
        ],
        instructions: [
          "Für den Teig:",
          "Mehl und Zucker mischen.",
          "Teig kneten.",
          "Für die Füllung:",
          "Quark glattrühren.",
        ],
      }),
      makeLookups(),
      null,
    );
    // Two sections, each with its own instructions
    expect(out.sections).toHaveLength(2);
    expect(out.sections[0].title).toBe("Für den Teig");
    expect(out.sections[0].instructions).toMatch(/Mehl und Zucker/);
    expect(out.sections[0].instructions).toMatch(/Teig kneten/);
    expect(out.sections[0].instructions).not.toMatch(/Quark/);
    expect(out.sections[1].title).toBe("Für die Füllung");
    expect(out.sections[1].instructions).toMatch(/Quark glattrühren/);
    expect(out.sections[1].instructions).not.toMatch(/Mehl/);
  });

  it("leading unsectioned instructions attach to the first section", () => {
    const out = transformFamilywallRecipe(
      makeRaw({
        ingredients: ["Für den Teig:", "200 g Mehl"],
        instructions: ["Ofen vorheizen.", "Für den Teig:", "Mehl mischen."],
      }),
      makeLookups(),
      null,
    );
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].title).toBe("Für den Teig");
    expect(out.sections[0].instructions).toMatch(/Ofen vorheizen/);
    expect(out.sections[0].instructions).toMatch(/Mehl mischen/);
  });

  it("wraps apple-variety descriptors in parens so they become notes", () => {
    expect(
      rewriteFamilywallAppleVarieties([
        "1 Apfel Gala",
        "1 Apfel Granny Smith",
        "1 Apfel Honeycrisp",
        "Apfel Sorte Boskoop",
        "apples Jonagold",
        "2 Pink Lady apples",
        "1 Granny Smith apple",
      ]),
    ).toEqual([
      "1 Apfel (Gala)",
      "1 Apfel (Granny Smith)",
      "1 Apfel (Honeycrisp)",
      "Apfel (Boskoop)",
      "apples (Jonagold)",
      "2 apples (Pink Lady)",
      "1 apple (Granny Smith)",
    ]);
  });

  it("leaves lines without apple-variety patterns alone", () => {
    expect(
      rewriteFamilywallAppleVarieties([
        "1 großer Apfel",
        "2 Äpfel",
        "1 Pink Floyd record",
        "1 Apfelmus",
        "200 g Mehl",
      ]),
    ).toEqual([
      "1 großer Apfel",
      "2 Äpfel",
      "1 Pink Floyd record",
      "1 Apfelmus",
      "200 g Mehl",
    ]);
  });

  it("wraps trailing personal-name suffixes in parens so they become notes", () => {
    expect(
      rewriteFamilywallPersonalLabels([
        "Beilage für Janine",
        "Dressing Janine",
        "Dressing Steven",
      ]),
    ).toEqual([
      "Beilage (für Janine)",
      "Dressing (Janine)",
      "Dressing (Steven)",
    ]);
  });

  it("doesn't touch ingredient lines that don't have a personal-label suffix", () => {
    expect(
      rewriteFamilywallPersonalLabels([
        "1 EL Olivenöl",
        "200 g Mehl",
        "Janine",
        "Steven Spielberg",
      ]),
    ).toEqual([
      "1 EL Olivenöl",
      "200 g Mehl",
      "Janine",
      "Steven Spielberg",
    ]);
  });

  it("rewrites 'Paprika' to 'Paprikapulver' when preceded by a spoon-volume unit", () => {
    expect(disambiguateFamilywallNames(["1 TL Paprika"])).toEqual([
      "1 TL Paprikapulver",
    ]);
    expect(disambiguateFamilywallNames(["0.5 EL Paprika edelsüß"])).toEqual([
      "0.5 EL Paprikapulver edelsüß",
    ]);
    expect(disambiguateFamilywallNames(["1/2 tsp paprika"])).toEqual([
      "1/2 tsp Paprikapulver",
    ]);
    expect(disambiguateFamilywallNames(["1 Prise Paprika"])).toEqual([
      "1 Prise Paprikapulver",
    ]);
  });

  it("leaves 'Paprika' alone when the unit is mass (could be bell pepper) or absent", () => {
    // Mass is ambiguous (200g of paprika could be peppers OR powder). Keep
    // the user's intent — they'll either get the bell-pepper canonical (via
    // Stück default) or land in the unmatched-pill UI.
    expect(disambiguateFamilywallNames(["200 g Paprika"])).toEqual([
      "200 g Paprika",
    ]);
    expect(disambiguateFamilywallNames(["1 Paprika"])).toEqual(["1 Paprika"]);
    expect(disambiguateFamilywallNames(["1 rote Paprika"])).toEqual([
      "1 rote Paprika",
    ]);
  });

  it("doesn't double-rewrite 'Paprikapulver'", () => {
    expect(disambiguateFamilywallNames(["1 TL Paprikapulver"])).toEqual([
      "1 TL Paprikapulver",
    ]);
  });

  it("does NOT promote ambiguous standalone words that can be real ingredients", () => {
    // "Salat" appears as a real ingredient (= lettuce) in at least one
    // cached familywall recipe; never promote it to a header even though
    // other recipes use it as a section title. Same for "Aufstrich".
    const promoted = promoteFamilywallSectionHeaders([
      "Salat",
      "Aufstrich",
      "Topping",
    ]);
    expect(promoted[0]).toBe("Salat");
    expect(promoted[1]).toBe("Aufstrich");
    expect(promoted[2]).toBe("Topping:");
  });

  it("leaves lines the generic detector already accepts untouched", () => {
    // Already-terminated colons / leading dashes / all-caps must not get
    // a second colon (would produce "FOO::" / "Teig::").
    const promoted = promoteFamilywallSectionHeaders([
      "Teig:",
      "-- Teig",
      "200 g Mehl",
    ]);
    expect(promoted).toEqual(["Teig:", "-- Teig", "200 g Mehl"]);
  });

  it("instructions without matching ingredient section become own section", () => {
    const out = transformFamilywallRecipe(
      makeRaw({
        ingredients: ["200 g Mehl"],
        instructions: [
          "Mehl sieben.",
          "Zum Servieren:",
          "Mit Puderzucker bestäuben.",
        ],
      }),
      makeLookups(),
      null,
    );
    expect(out.sections).toHaveLength(2);
    expect(out.sections[0].instructions).toMatch(/Mehl sieben/);
    expect(out.sections[1].title).toBe("Zum Servieren");
    expect(out.sections[1].ingredients).toHaveLength(0);
    expect(out.sections[1].instructions).toMatch(/Puderzucker/);
  });
});
