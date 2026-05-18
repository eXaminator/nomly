import { describe, it, expect } from "vitest";
import { transformFamilywallRecipe } from "@/lib/familywall/transform";
import type {
  IngredientLookup,
  UnitLookup,
} from "@/lib/recipe-import/index";
import type { FamilywallRawRecipe } from "@/lib/familywall/types";

function makeLookups(): { units: UnitLookup; ingredients: IngredientLookup } {
  const units: UnitLookup = {
    byNameOrAlias: new Map([
      ["g", { id: 1, name: "g" }],
      ["el", { id: 2, name: "EL" }],
      ["tablespoon", { id: 2, name: "EL" }],
      ["stück", { id: 3, name: "Stück" }],
      ["cup", { id: 4, name: "Cup" }],
    ]),
    byCanonicalName: new Map([
      ["g", { id: 1, name: "g" }],
      ["el", { id: 2, name: "EL" }],
      ["stück", { id: 3, name: "Stück" }],
      ["cup", { id: 4, name: "Cup" }],
    ]),
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
      quantity: 500,
      unitId: 1, // g
      notes: null,
    });
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
});
