import { describe, expect, it } from "vitest";
import {
  buildImportSections,
  type IngredientLookup,
  type ParseLookups,
  type UnitLookup,
} from "@/lib/recipe-import";
import { extractIngredientGroupsFromHtml } from "@/lib/recipe-import/html-groups";
import {
  asImageUrl,
  asInstructionGroups,
  asServings,
  asString,
  asStringList,
} from "@/lib/recipe-import/json-ld";
import { extractMicrodataRecipe } from "@/lib/recipe-import/microdata";
import { parseIsoDurationToMinutes } from "@/lib/recipe-import/duration";

function makeLookups(): ParseLookups {
  const unitEntries = ["g"].map(
    (name, i) => [name, { id: i + 1, name, isContainer: false }] as const,
  );
  const units: UnitLookup = {
    byNameOrAlias: new Map(unitEntries),
    byCanonicalName: new Map(unitEntries),
    byId: new Map(unitEntries.map(([, e]) => [e.id, e] as const)),
    containerTokens: new Set(),
    unspecificTokens: new Set(),
    maxUnitTokens: 1,
    globalDefaultUnitId: null,
  };
  const ingredients: IngredientLookup = new Map();
  return { units, ingredients, ingredientCatalog: [] };
}

// Modeled on www2.ankarsrum.com/de/rezepte/kuerbiskuchen (2026-11-25): no
// Recipe in JSON-LD (only Yoast's WebPage graph), Microdata only. A heading
// before each ingredient list and each step list; the step <ol>s carry
// itemprop="recipeInstructions" and their <li>s itemprop="step"; the first
// <ol> is empty; the image itemprop sits on an <img> inside a <picture>.
const SECTIONED_HTML = `<html><head>
<meta property="og:image" content="https://example.com/og.jpg" />
<script type="application/ld+json" class="yoast-schema-graph">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"Kürbiskuchen"}]}</script>
</head><body>
<div itemscope itemtype="https://schema.org/Recipe" class="singe-recipe-page">
<article>
  <div class="img-wrap"><picture>
    <source srcset="/img/pie-210.webp 210w" type="image/webp">
    <img width="600" src="/img/pie-600.webp" itemprop="image" alt="">
  </picture>
  <div class="recipe-ingredients">
    <h2>Zutaten</h2>
    <h4>Kuchenteig: </h4>
    <ul>
      <li itemprop="recipeIngredient"><span>
        175 g Butter </span></li>
      <li itemprop="recipeIngredient"><span>1 EL Wasser (falls erforderlich)</span></li>
    </ul>
    <h4>Füllung: </h4>
    <ul>
      <li itemprop="recipeIngredient"><span>400 g Kürbispüree</span></li>
      <li itemprop="recipeIngredient"><span>2 Ei</span></li>
      <li itemprop="recipeIngredient"><span>½ TL Salz</span></li>
    </ul>
  </div></div>
  <h1 itemprop="name">Kürbiskuchen</h1>
  <div itemprop="description"><p>Ein mit Kardamom gewürzter Kürbiskuchen. </p></div>
  <span itemprop="recipeCategory">Das dessert</span>
  <span itemprop="recipeYield">
    8 </span>
  <div class="recipe-instructions">
    <h2>Folge diesen Schritten</h2>
    <ol itemprop="recipeInstructions"></ol><h4>Kuchenteig</h4><ol itemprop="recipeInstructions"><li itemprop="step"><p> Butter und Mehl
      verkneten. </p></li><li itemprop="step"><p> Kalt stellen. </p></li></ol><h4>Füllung</h4><ol itemprop="recipeInstructions"><li itemprop="step"><p> Alles verrühren. </p></li></ol>
  </div>
</article>
</div>
</body></html>`;

describe("extractMicrodataRecipe", () => {
  it("reads a sectioned Microdata recipe", () => {
    const r = extractMicrodataRecipe(SECTIONED_HTML)!;
    expect(r).not.toBeNull();
    expect(asString(r.name)).toBe("Kürbiskuchen");
    expect(asString(r.description)).toBe(
      "Ein mit Kardamom gewürzter Kürbiskuchen.",
    );
    expect(asServings(r.recipeYield)).toBe(8);
    expect(r.recipeCategory).toBe("Das dessert");
    // Relative — resolved against the page URL by the importer.
    expect(asImageUrl(r.image)).toBe("/img/pie-600.webp");
    expect(r.recipeIngredient).toEqual([
      "175 g Butter",
      "1 EL Wasser (falls erforderlich)",
      "400 g Kürbispüree",
      "2 Ei",
      "½ TL Salz",
    ]);
    // Empty first <ol> dropped; headings become HowToSection names.
    expect(asInstructionGroups(r.recipeInstructions)).toEqual([
      {
        title: "Kuchenteig",
        lines: ["Butter und Mehl verkneten.", "Kalt stellen."],
      },
      { title: "Füllung", lines: ["Alles verrühren."] },
    ]);
  });

  it("reads the classic schema.org example markup", () => {
    // Shape of the Microdata example on schema.org/Recipe: meta/time values,
    // a nested author Person, one step per <li>.
    const html = `<div itemscope itemtype="http://schema.org/Recipe">
      <span itemprop="name">Mom's World Famous Banana Bread</span>
      By <span itemprop="author" itemscope itemtype="http://schema.org/Person"><span itemprop="name">John Smith</span></span>,
      <meta itemprop="datePublished" content="2009-05-08">May 8, 2009
      <img itemprop="image" src="bananabread.jpg" alt="Banana bread on a plate" />
      <span itemprop="description">This classic banana bread recipe comes from my mom.</span>
      Prep Time: <meta itemprop="prepTime" content="PT15M">15 minutes
      Cook time: <time itemprop="cookTime" datetime="PT1H">1 hour</time>
      Yield: <span itemprop="recipeYield">1 loaf</span>
      <meta itemprop="keywords" content="banana, bread, baking">
      Ingredients:
      - <span itemprop="recipeIngredient">3 or 4 ripe bananas, smashed</span>
      - <span itemprop="recipeIngredient">1 egg</span>
      - <span itemprop="recipeIngredient">3/4 cup of sugar</span>
      Instructions:
      <ol>
        <li itemprop="recipeInstructions">Preheat the oven to 350 degrees.</li>
        <li itemprop="recipeInstructions">Mix in the ingredients in a bowl.</li>
      </ol>
    </div>`;
    const r = extractMicrodataRecipe(html)!;
    expect(asString(r.name)).toBe("Mom's World Famous Banana Bread");
    // The author's name belongs to the nested Person, not to the Recipe.
    expect(r.author).toEqual({ "@type": "Person", name: "John Smith" });
    expect(parseIsoDurationToMinutes(r.prepTime)).toBe(15);
    expect(parseIsoDurationToMinutes(r.cookTime)).toBe(60);
    expect(asServings(r.recipeYield)).toBe(1);
    expect(r.keywords).toBe("banana, bread, baking");
    expect(asImageUrl(r.image)).toBe("bananabread.jpg");
    expect(r.recipeIngredient).toEqual([
      "3 or 4 ripe bananas, smashed",
      "1 egg",
      "3/4 cup of sugar",
    ]);
    expect(asStringList(r.recipeInstructions)).toEqual([
      "Preheat the oven to 350 degrees.",
      "Mix in the ingredients in a bowl.",
    ]);
  });

  it("splits a single wrapper element into its list items or lines", () => {
    const html = `<div itemscope itemtype="https://schema.org/Recipe">
      <h1 itemprop="name">Pfannkuchen</h1>
      <ul itemprop="recipeIngredient"><li>200 g Mehl</li><li>2 Eier</li></ul>
      <div itemprop="recipeInstructions">
        <p>Alles verrühren.</p>
        <p>In der Pfanne<br>ausbacken.</p>
      </div>
    </div>`;
    const r = extractMicrodataRecipe(html)!;
    expect(r.recipeIngredient).toEqual(["200 g Mehl", "2 Eier"]);
    expect(asStringList(r.recipeInstructions)).toEqual([
      "Alles verrühren.",
      "In der Pfanne",
      "ausbacken.",
    ]);
  });

  it("reads nested HowToSection / HowToStep items", () => {
    const html = `<div itemscope itemtype="https://schema.org/Recipe">
      <h1 itemprop="name">Pizza</h1>
      <span itemprop="recipeIngredient">500 g Mehl</span>
      <div itemprop="recipeInstructions" itemscope itemtype="https://schema.org/HowToSection">
        <h3 itemprop="name">Teig</h3>
        <div itemprop="itemListElement" itemscope itemtype="https://schema.org/HowToStep">
          <p itemprop="text">Kneten.</p>
        </div>
        <div itemprop="itemListElement" itemscope itemtype="https://schema.org/HowToStep">
          <p itemprop="text">Gehen lassen.</p>
        </div>
      </div>
      <div itemprop="recipeInstructions" itemscope itemtype="https://schema.org/HowToSection">
        <meta itemprop="name" content="Belag">
        <div itemprop="itemListElement" itemscope itemtype="https://schema.org/HowToStep">
          <span itemprop="text">Belegen.</span>
        </div>
      </div>
    </div>`;
    const r = extractMicrodataRecipe(html)!;
    expect(asInstructionGroups(r.recipeInstructions)).toEqual([
      { title: "Teig", lines: ["Kneten.", "Gehen lassen."] },
      { title: "Belag", lines: ["Belegen."] },
    ]);
  });

  it("accepts the legacy data-vocabulary.org vocabulary", () => {
    const html = `<div itemscope itemtype="http://data-vocabulary.org/Recipe">
      <h1 itemprop="name">Kartoffelsalat</h1>
      <img itemprop="photo" src="https://example.com/salat.jpg">
      <p itemprop="summary">Wie bei Oma.</p>
      <span itemprop="yield">4 Portionen</span>
      <span itemprop="ingredient" itemscope itemtype="http://data-vocabulary.org/RecipeIngredient">
        <span itemprop="amount">1 kg</span> <span itemprop="name">Kartoffeln</span>
      </span>
      <span itemprop="ingredient" itemscope itemtype="http://data-vocabulary.org/RecipeIngredient">
        <span itemprop="amount">1</span> <span itemprop="name">Zwiebel</span>
      </span>
      <div itemprop="instructions"><ol><li>Kochen.</li><li>Schneiden.</li></ol></div>
    </div>`;
    const r = extractMicrodataRecipe(html)!;
    expect(asString(r.description)).toBe("Wie bei Oma.");
    expect(asServings(r.recipeYield)).toBe(4);
    expect(asImageUrl(r.image)).toBe("https://example.com/salat.jpg");
    expect(r.recipeIngredient).toEqual(["1 kg Kartoffeln", "1 Zwiebel"]);
    expect(asStringList(r.recipeInstructions)).toEqual([
      "Kochen.",
      "Schneiden.",
    ]);
  });

  it("follows itemref and finds a Recipe nested in another item", () => {
    const html = `<body itemscope itemtype="https://schema.org/WebPage">
      <div itemprop="mainEntity" itemscope itemtype="https://schema.org/Recipe" itemref="zutaten">
        <h1 itemprop="name">Suppe</h1>
        <p itemprop="recipeInstructions">Kochen.</p>
      </div>
      <aside><ul id="zutaten"><li itemprop="recipeIngredient">1 l Brühe</li></ul></aside>
    </body>`;
    const r = extractMicrodataRecipe(html)!;
    expect(asString(r.name)).toBe("Suppe");
    expect(r.recipeIngredient).toEqual(["1 l Brühe"]);
    expect(asStringList(r.recipeInstructions)).toEqual(["Kochen."]);
  });

  it("uses lazy-load attributes, then og:image, for the image", () => {
    const lazy = `<div itemscope itemtype="https://schema.org/Recipe">
      <img itemprop="image" src="data:image/gif;base64,R0lGOD" data-src="/real.jpg">
      <span itemprop="recipeIngredient">1 Ei</span>
    </div>`;
    expect(asImageUrl(extractMicrodataRecipe(lazy)!.image)).toBe("/real.jpg");

    const none = `<head><meta property="og:image" content="https://example.com/og.jpg"></head>
      <div itemscope itemtype="https://schema.org/Recipe"><span itemprop="recipeIngredient">1 Ei</span></div>`;
    expect(asImageUrl(extractMicrodataRecipe(none)!.image)).toBe(
      "https://example.com/og.jpg",
    );
  });

  it("returns null without a Recipe item or without any content", () => {
    expect(extractMicrodataRecipe("<p>Hallo</p>")).toBeNull();
    expect(
      extractMicrodataRecipe(
        `<div itemscope itemtype="https://schema.org/Article"><span itemprop="name">x</span></div>`,
      ),
    ).toBeNull();
    expect(
      extractMicrodataRecipe(
        `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Leer</h1></div>`,
      ),
    ).toBeNull();
  });
});

describe("Microdata ingredient groups", () => {
  it("groups recipeIngredient lists by the heading before each", () => {
    const groups = extractIngredientGroupsFromHtml(SECTIONED_HTML);
    expect(groups!.map((g) => ({ title: g.title, n: g.items.length }))).toEqual([
      { title: "Kuchenteig", n: 2 },
      { title: "Füllung", n: 3 },
    ]);
  });

  it("ignores a single list even when a heading precedes it", () => {
    const html = `<div itemscope itemtype="https://schema.org/Recipe">
      <h2>Zutaten</h2>
      <ul><li itemprop="recipeIngredient">1 Ei</li><li itemprop="recipeIngredient">Salz</li></ul>
    </div>`;
    expect(extractIngredientGroupsFromHtml(html)).toBeNull();
  });

  it("looks through a wrapper between the heading and the list", () => {
    const html = `<div itemscope itemtype="https://schema.org/Recipe">
      <h3>Teig</h3><div class="list"><ul><li itemprop="recipeIngredient">Mehl</li></ul></div>
      <h3>Belag</h3><div class="list"><ul><li itemprop="recipeIngredient">Käse</li></ul></div>
    </div>`;
    expect(extractIngredientGroupsFromHtml(html)!.map((g) => g.title)).toEqual([
      "Teig",
      "Belag",
    ]);
  });
});

describe("buildImportSections on a Microdata recipe", () => {
  it("pairs ingredient groups with the matching step sections", () => {
    const recipe = extractMicrodataRecipe(SECTIONED_HTML)!;
    const { ingredientGroups, instructionGroups } = buildImportSections(
      recipe,
      SECTIONED_HTML,
      makeLookups(),
    );
    expect(
      ingredientGroups.map((g) => ({ title: g.title, n: g.ingredients.length })),
    ).toEqual([
      { title: "Kuchenteig", n: 2 },
      { title: "Füllung", n: 3 },
    ]);
    expect(ingredientGroups[0].ingredients[0].rawText).toBe("175 g Butter");
    expect(instructionGroups.map((g) => g.title)).toEqual([
      "Kuchenteig",
      "Füllung",
    ]);
  });
});
