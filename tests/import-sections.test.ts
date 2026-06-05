import { describe, expect, it } from "vitest";
import {
  buildImportSections,
  mergeIngredientAndInstructionSections,
  type IngredientLookup,
  type ParseLookups,
  type UnitLookup,
} from "@/lib/recipe-import";
import { extractJsonLdRecipe } from "@/lib/recipe-import/json-ld";

function makeLookups(): ParseLookups {
  const unitEntries = ["g"].map(
    (name, i) => [name, { id: i + 1, name, isContainer: false }] as const,
  );
  const units: UnitLookup = {
    byNameOrAlias: new Map(unitEntries),
    byCanonicalName: new Map(unitEntries),
    byId: new Map(unitEntries.map(([, e]) => [e.id, e] as const)),
    containerTokens: new Set(),
    globalDefaultUnitId: null,
  };
  const ingredients: IngredientLookup = new Map();
  return { units, ingredients, ingredientCatalog: [] };
}

// Modeled on cozypeachkitchen.com/veggie-reuben-with-quick-pickled-cabbage
// (2026-06-05): flat recipeIngredient, HowToSection instructions, WPRM
// ingredient-group markup. The singular/plural mismatch between the
// "Vegetarian Reuben" ingredient group and the "Vegetarian Reubens"
// instruction section is REAL — the merge keeps them separate by design.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Vegetarian Reuben",
  recipeIngredient: [
    "1/2 medium red cabbage",
    "2 1/2 cups water",
    "1 cup apple cider vinegar (see note #1)",
    "5 ounces plain Greek yogurt",
    "3 tablespoons ketchup",
    "8 slices rye bread",
    "8 slices Swiss cheese",
  ],
  recipeInstructions: [
    {
      "@type": "HowToSection",
      name: "Quick Pickled Cabbage",
      itemListElement: [
        { "@type": "HowToStep", text: "Slice the red cabbage." },
        { "@type": "HowToStep", text: "Add cabbage and garlic." },
      ],
    },
    {
      "@type": "HowToSection",
      name: "Horseradish Sauce",
      itemListElement: [{ "@type": "HowToStep", text: "Whisk to combine." }],
    },
    {
      "@type": "HowToSection",
      name: "Vegetarian Reubens",
      itemListElement: [{ "@type": "HowToStep", text: "Assemble and press." }],
    },
  ],
};

function wprmLi(text: string): string {
  return `<li class="wprm-recipe-ingredient"><span class="wprm-recipe-ingredient-name">${text}</span></li>`;
}

function wprmGroup(title: string, items: string[]): string {
  return `<div class="wprm-recipe-ingredient-group">
    <h4 class="wprm-recipe-group-name wprm-recipe-ingredient-group-name">${title}</h4>
    <ul class="wprm-recipe-ingredients">${items.map(wprmLi).join("")}</ul>
  </div>`;
}

const PAGE_HTML = `<html><head>
<script type="application/ld+json">${JSON.stringify(JSON_LD)}</script>
</head><body><div class="wprm-recipe-container">
${wprmGroup("Quick Pickled Cabbage", ["red cabbage", "water", "apple cider vinegar"])}
${wprmGroup("Horseradish Sauce", ["Greek yogurt", "ketchup"])}
${wprmGroup("Vegetarian Reuben", ["rye bread", "Swiss cheese"])}
</div></body></html>`;

const joinLines = (lines: string[]) => lines.join("\n");

describe("buildImportSections", () => {
  it("recovers ingredient groups from HTML and instruction sections from JSON-LD", () => {
    const recipe = extractJsonLdRecipe(PAGE_HTML)!;
    const { ingredientGroups, instructionGroups } = buildImportSections(
      recipe,
      PAGE_HTML,
      makeLookups(),
    );

    expect(
      ingredientGroups.map((g) => ({ title: g.title, n: g.ingredients.length })),
    ).toEqual([
      { title: "Quick Pickled Cabbage", n: 3 },
      { title: "Horseradish Sauce", n: 2 },
      { title: "Vegetarian Reuben", n: 2 },
    ]);
    // The parsed rows come from the JSON-LD strings, not the HTML text.
    expect(ingredientGroups[0].ingredients[0].rawText).toBe(
      "1/2 medium red cabbage",
    );

    expect(instructionGroups.map((g) => g.title)).toEqual([
      "Quick Pickled Cabbage",
      "Horseradish Sauce",
      "Vegetarian Reubens",
    ]);

    const merged = mergeIngredientAndInstructionSections(
      ingredientGroups,
      instructionGroups,
      joinLines,
    );
    // Singular/plural mismatch on the third title → 4 sections by design.
    expect(
      merged.map((s) => ({
        title: s.title,
        n: s.ingredients.length,
        hasInstructions: s.instructions.length > 0,
      })),
    ).toEqual([
      { title: "Quick Pickled Cabbage", n: 3, hasInstructions: true },
      { title: "Horseradish Sauce", n: 2, hasInstructions: true },
      { title: "Vegetarian Reuben", n: 2, hasInstructions: false },
      { title: "Vegetarian Reubens", n: 0, hasInstructions: true },
    ]);
  });

  it("falls back to flat parsing when HTML group counts mismatch JSON-LD", () => {
    // Same page but one HTML item removed → counts disagree → no grouping.
    const broken = PAGE_HTML.replace(wprmLi("water"), "");
    expect(broken).not.toBe(PAGE_HTML); // guard: the removal actually fired
    const recipe = extractJsonLdRecipe(broken)!;
    const { ingredientGroups } = buildImportSections(
      recipe,
      broken,
      makeLookups(),
    );
    expect(ingredientGroups.map((g) => g.title)).toEqual([null]);
    expect(ingredientGroups[0].ingredients).toHaveLength(7);
  });

  it("falls back to text-heuristic instruction sections without HowToSection", () => {
    const flat = {
      ...JSON_LD,
      recipeInstructions: ["Für den Teig:", "Kneten.", "Backen."],
    };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(
      flat,
    )}</script></head><body></body></html>`;
    const recipe = extractJsonLdRecipe(html)!;
    const { instructionGroups } = buildImportSections(recipe, html, makeLookups());
    expect(instructionGroups).toEqual([
      { title: "Für den Teig", lines: ["Kneten.", "Backen."] },
    ]);
  });
});
