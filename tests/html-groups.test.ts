import { describe, expect, it } from "vitest";
import {
  alignHtmlGroupsToLines,
  extractIngredientGroupsFromHtml,
} from "@/lib/recipe-import/html-groups";

// ── fixtures modeled on verified real-page markup (2026-06-05) ──

// cozypeachkitchen.com — WP Recipe Maker. Note the instruction group at the
// end whose h4 ALSO carries wprm-recipe-group-name: it must not leak in.
const WPRM_HTML = `<html><body><div class="wprm-recipe-container">
<div class="wprm-recipe-ingredient-group">
  <h4 class="wprm-recipe-group-name wprm-recipe-ingredient-group-name wprm-block-text-faded">Quick Pickled Cabbage</h4>
  <ul class="wprm-recipe-ingredients">
    <li class="wprm-recipe-ingredient" data-uid="1"><span class="wprm-checkbox-container"><input type="checkbox"><label><span class="sr-only">▢ </span></label></span><span class="wprm-recipe-ingredient-amount">½</span> <span class="wprm-recipe-ingredient-unit">medium</span> <span class="wprm-recipe-ingredient-name">red cabbage</span></li>
    <li class="wprm-recipe-ingredient" data-uid="2"><span class="wprm-recipe-ingredient-amount">2 ½</span> <span class="wprm-recipe-ingredient-unit">cups</span> <span class="wprm-recipe-ingredient-name">water</span></li>
  </ul>
</div>
<div class="wprm-recipe-ingredient-group">
  <h4 class="wprm-recipe-group-name wprm-recipe-ingredient-group-name wprm-block-text-faded">Horseradish Sauce</h4>
  <ul class="wprm-recipe-ingredients">
    <li class="wprm-recipe-ingredient" data-uid="3"><span class="wprm-recipe-ingredient-amount">3</span> <span class="wprm-recipe-ingredient-unit">tablespoons</span> <span class="wprm-recipe-ingredient-name">ketchup</span> <span class="wprm-recipe-ingredient-notes">(see note #2)</span></li>
  </ul>
</div>
<div class="wprm-recipe-instruction-group">
  <h4 class="wprm-recipe-group-name wprm-recipe-instruction-group-name">Quick Pickled Cabbage</h4>
  <ul class="wprm-recipe-instructions"><li class="wprm-recipe-instruction">Slice the cabbage.</li></ul>
</div>
</div></body></html>`;

// sallysbakingaddiction.com — Tasty Recipes. Unnamed lead group, then an h4
// group. The "Ingredients" h3 lives in the header div, outside the body.
const TASTY_HTML = `<html><body><div class="tasty-recipes-ingredients">
<div class="tasty-recipes-ingredients-header"><h3>Ingredients</h3></div>
<div class="tasty-recipes-ingredients-body">
  <ul>
    <li data-tr-ingredient-checkbox=""><span class="tr-ingredient-checkbox-container"><input type="checkbox"><label></label></span><span data-amount="0.5" data-unit="cup">1/2 cup</span> <strong>unsalted butter</strong>, softened</li>
    <li data-tr-ingredient-checkbox=""><span data-amount="4">4</span> large <strong>eggs</strong></li>
  </ul>
  <h4>Cream Cheese Frosting</h4>
  <ul>
    <li data-tr-ingredient-checkbox=""><span data-amount="8" data-unit="ounce">8 ounces</span> <strong>cream cheese</strong></li>
  </ul>
</div>
</div></body></html>`;

// tidymom.net (recipe-scrapers fixture) — Mediavine Create. The card title
// h3 carries mv-create-ingredients-title and must not become a group.
const CREATE_HTML = `<html><body><div class="mv-create-ingredients">
<h3 class="mv-create-ingredients-title mv-create-title-secondary">Ingredients</h3>
<h4>Crust</h4>
<ul>
  <li> 1 pizza crust </li>
  <li> 1 teaspoon olive oil </li>
</ul>
<h4>Topping</h4>
<ul>
  <li> 2/3 cup ranch dressing </li>
</ul>
</div></body></html>`;

describe("extractIngredientGroupsFromHtml", () => {
  it("extracts WPRM ingredient groups, ignoring instruction groups", () => {
    const groups = extractIngredientGroupsFromHtml(WPRM_HTML);
    expect(groups).not.toBeNull();
    expect(groups!.map((g) => ({ title: g.title, n: g.items.length }))).toEqual([
      { title: "Quick Pickled Cabbage", n: 2 },
      { title: "Horseradish Sauce", n: 1 },
    ]);
    // Item text comes from the content spans, without checkbox noise.
    expect(groups![0].items[0]).toBe("½ medium red cabbage");
    expect(groups![1].items[0]).toBe("3 tablespoons ketchup (see note #2)");
  });

  it("extracts Tasty groups with an unnamed lead group", () => {
    const groups = extractIngredientGroupsFromHtml(TASTY_HTML);
    expect(groups).not.toBeNull();
    expect(groups!.map((g) => ({ title: g.title, n: g.items.length }))).toEqual([
      { title: null, n: 2 },
      { title: "Cream Cheese Frosting", n: 1 },
    ]);
  });

  it("extracts Create groups, skipping the card-title heading", () => {
    const groups = extractIngredientGroupsFromHtml(CREATE_HTML);
    expect(groups).not.toBeNull();
    expect(groups!.map((g) => ({ title: g.title, n: g.items.length }))).toEqual([
      { title: "Crust", n: 2 },
      { title: "Topping", n: 1 },
    ]);
    expect(groups![0].items[0]).toBe("1 pizza crust");
  });

  it("returns null when no plugin markup is present", () => {
    expect(
      extractIngredientGroupsFromHtml("<html><body><p>hi</p></body></html>"),
    ).toBeNull();
  });

  it("returns null when groups exist but none has a title", () => {
    const html = `<div class="wprm-recipe-container"><div class="wprm-recipe-ingredient-group">
      <ul><li class="wprm-recipe-ingredient"><span class="wprm-recipe-ingredient-name">salt</span></li></ul>
    </div></div>`;
    expect(extractIngredientGroupsFromHtml(html)).toBeNull();
  });

  it("scopes WPRM to the first recipe container", () => {
    const second = WPRM_HTML.replace("</body></html>", "");
    const doubled = `${second}<div class="wprm-recipe-container"><div class="wprm-recipe-ingredient-group">
      <h4 class="wprm-recipe-ingredient-group-name">Other Card</h4>
      <ul><li class="wprm-recipe-ingredient"><span class="wprm-recipe-ingredient-name">x</span></li></ul>
    </div></div></body></html>`;
    const groups = extractIngredientGroupsFromHtml(doubled);
    expect(groups!.map((g) => g.title)).toEqual([
      "Quick Pickled Cabbage",
      "Horseradish Sauce",
    ]);
  });
});

describe("alignHtmlGroupsToLines", () => {
  const groups = [
    { title: "A", items: ["x", "y"] },
    { title: "B", items: ["z"] },
  ];

  it("slices the canonical lines by group counts", () => {
    expect(alignHtmlGroupsToLines(groups, ["1", "2", "3"])).toEqual([
      { title: "A", lines: ["1", "2"] },
      { title: "B", lines: ["3"] },
    ]);
  });

  it("refuses on count mismatch", () => {
    expect(alignHtmlGroupsToLines(groups, ["1", "2"])).toBeNull();
    expect(alignHtmlGroupsToLines(groups, ["1", "2", "3", "4"])).toBeNull();
    expect(alignHtmlGroupsToLines([], [])).toBeNull();
  });

  it("passes an unnamed lead group through (Tasty-style)", () => {
    expect(
      alignHtmlGroupsToLines(
        [
          { title: null, items: ["x"] },
          { title: "Frosting", items: ["y"] },
        ],
        ["1", "2"],
      ),
    ).toEqual([
      { title: null, lines: ["1"] },
      { title: "Frosting", lines: ["2"] },
    ]);
  });
});
