import { describe, it, expect } from "vitest";
import { parseIsoDurationToMinutes } from "@/lib/recipe-import/duration";
import { parseIngredientString } from "@/lib/recipe-import/ingredient";
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
    "g", "kg", "mg",
    "ml", "cl", "dl", "l",
    "el", "tl",
    "cup", "cups",
    "tsp", "teaspoon", "teaspoons",
    "tbsp", "tablespoon", "tablespoons",
    "pkg", "pck", "packung", "packungen", "päckchen",
    "dose", "dosen",
    "stück", "stk",
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
    });
  });
  it("separates notes after a comma", () => {
    expect(parse("200 g Speck, gewürfelt")).toEqual({
      quantity: 200,
      unitName: "g",
      name: "Speck",
      notes: "gewürfelt",
    });
  });
  it("handles German decimals", () => {
    expect(parse("0,5 l Sahne")).toEqual({
      quantity: 0.5,
      unitName: "l",
      name: "Sahne",
      notes: null,
    });
  });
  it("handles fractions", () => {
    const r = parse("1 1/2 Tassen Mehl");
    expect(r.quantity).toBeCloseTo(1.5, 2);
    // "Tassen" is not in the known unit list, so it stays in the name.
    expect(r.unitName).toBeNull();
    expect(r.name).toBe("Tassen Mehl");
  });
  it("handles unicode fraction glyphs", () => {
    expect(parse("½ TL Salz")).toEqual({
      quantity: 0.5,
      unitName: "TL",
      name: "Salz",
      notes: null,
    });
  });
  it("strips leading 'ca.'", () => {
    expect(parse("ca. 300 ml Brühe")).toEqual({
      quantity: 300,
      unitName: "ml",
      name: "Brühe",
      notes: null,
    });
  });
  it("averages ranges", () => {
    expect(parse("100-200 g Käse")).toEqual({
      quantity: 150,
      unitName: "g",
      name: "Käse",
      notes: null,
    });
  });
  it("averages a fraction-int range", () => {
    const r = parse("1/2-1 cup peanut butter");
    expect(r.quantity).toBeCloseTo(0.75, 3);
    expect(r.unitName).toBe("cup");
    expect(r.name).toBe("peanut butter");
  });
  it("averages an int → mixed-fraction range across token boundaries", () => {
    const r = parse("1- 1 1/2 teaspoons sea salt");
    expect(r.quantity).toBeCloseTo(1.25, 3);
    expect(r.unitName).toBe("teaspoons");
    expect(r.name).toBe("sea salt");
  });
  it("leaves unitless ingredients alone", () => {
    expect(parse("3 Eier")).toEqual({
      quantity: 3,
      unitName: null,
      name: "Eier",
      notes: null,
    });
  });
  it("returns the original when nothing parses", () => {
    expect(parse("Salz nach Geschmack")).toEqual({
      quantity: null,
      unitName: null,
      name: "Salz nach Geschmack",
      notes: null,
    });
  });
  it("accepts a DB-added alias like 'Pck.' without parser changes", () => {
    expect(parse("1 Pck. Blätterteig")).toEqual({
      quantity: 1,
      unitName: "Pck",
      name: "Blätterteig",
      notes: null,
    });
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
