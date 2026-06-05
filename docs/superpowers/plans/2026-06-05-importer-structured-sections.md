# URL Importer: Structured Section Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** URL imports recover named ingredient/instruction sections from JSON-LD `HowToSection` structure and from WP Recipe Maker / Tasty Recipes / Mediavine Create HTML markup, instead of flattening everything into one unnamed section.

**Architecture:** Two independent signals feed the existing section pipeline as pre-grouped structures: (1) `asInstructionGroups()` preserves `HowToSection` names that `asStringList()` currently drops; (2) a new `html-groups.ts` extracts plugin ingredient-group boundaries from HTML and aligns them (count-gated) onto the canonical flat JSON-LD `recipeIngredient` strings. A new `parseIngredientGroupsIntoSections()` consumes pre-grouped lines without text-heuristic header re-detection. `mergeIngredientAndInstructionSections()` is unchanged.

**Tech Stack:** TypeScript, Next.js server lib, vitest, `node-html-parser` (new runtime dep).

**Spec:** `docs/superpowers/specs/2026-06-05-importer-structured-sections-design.md`

**Verified ground truth** (from real pages, 2026-06-05):
- cozypeachkitchen.com (WPRM): JSON-LD `recipeIngredient` = flat 19 strings, NO group headers. JSON-LD `recipeInstructions` = 3 `HowToSection`s named "Quick Pickled Cabbage" / "Horseradish Sauce" / "Vegetarian Reuben**s**". HTML ingredient groups: "Quick Pickled Cabbage" (7) / "Horseradish Sauce" (5) / "Vegetarian Reuben" (7) — note singular/plural mismatch with the instruction section; the merge will produce 4 sections (acceptable per spec, no fuzzy matching).
- WPRM markup: `div.wprm-recipe-ingredient-group` > `h4.wprm-recipe-group-name.wprm-recipe-ingredient-group-name` + `ul > li.wprm-recipe-ingredient` (with `span.wprm-recipe-ingredient-{amount,unit,name,notes}` children). **CAUTION:** `wprm-recipe-group-name` is ALSO used by instruction groups — scope via `wprm-recipe-ingredient-group-name` / the `wprm-recipe-ingredient-group` container.
- Tasty Recipes (sallysbakingaddiction.com): `div.tasty-recipes-ingredients` > `div.tasty-recipes-ingredients-header` (contains an h3 "Ingredients" — NOT a group) + `div.tasty-recipes-ingredients-body` containing alternating `<h4>Group Name</h4>` and `<ul>` with `li[data-tr-ingredient-checkbox]`. First `<ul>` may have no heading (unnamed lead group).
- Mediavine Create (recipe-scrapers fixtures): `div.mv-create-ingredients` containing `h3.mv-create-ingredients-title` ("Ingredients" — NOT a group) + alternating h3/h4 group headings and `<ul>` with plain `<li>`s. recipe-scrapers uses `.mv-create-ingredients h4` (tidymom) and `.mv-create-ingredients h3` (keytomylime) for group headings.

---

### Task 1: `asInstructionGroups()` in `json-ld.ts`

**Files:**
- Modify: `src/lib/recipe-import/json-ld.ts` (add below `asStringList`, ~line 153)
- Test: `tests/recipe-import.test.ts` (add describe after "JSON-LD field coercion", ~line 834)

- [ ] **Step 1: Write the failing tests**

Add to `tests/recipe-import.test.ts` — extend the json-ld import at the top of the file:

```ts
import {
  asImageUrl,
  asInstructionGroups,
  asServings,
  asString,
  asStringList,
  extractJsonLdRecipe,
} from "@/lib/recipe-import/json-ld";
```

Add a new describe block:

```ts
describe("asInstructionGroups", () => {
  it("preserves HowToSection names that asStringList drops", () => {
    expect(
      asInstructionGroups([
        {
          "@type": "HowToSection",
          name: "Quick Pickled Cabbage",
          itemListElement: [
            { "@type": "HowToStep", text: "Slice the cabbage." },
            { "@type": "HowToStep", text: "Add garlic." },
          ],
        },
        {
          "@type": "HowToSection",
          name: "Horseradish Sauce",
          itemListElement: [{ "@type": "HowToStep", text: "Whisk to combine." }],
        },
      ]),
    ).toEqual([
      {
        title: "Quick Pickled Cabbage",
        lines: ["Slice the cabbage.", "Add garlic."],
      },
      { title: "Horseradish Sauce", lines: ["Whisk to combine."] },
    ]);
  });

  it("returns a single unnamed group for flat step lists", () => {
    expect(
      asInstructionGroups([
        { "@type": "HowToStep", text: "Mix" },
        { "@type": "HowToStep", text: "Bake" },
      ]),
    ).toEqual([{ title: null, lines: ["Mix", "Bake"] }]);
    expect(asInstructionGroups(["A", "B"])).toEqual([
      { title: null, lines: ["A", "B"] },
    ]);
    expect(asInstructionGroups("Just do it")).toEqual([
      { title: null, lines: ["Just do it"] },
    ]);
  });

  it("collects loose steps before a section into an unnamed lead group", () => {
    expect(
      asInstructionGroups([
        { "@type": "HowToStep", text: "Preheat the oven." },
        {
          "@type": "HowToSection",
          name: "Dough",
          itemListElement: [{ "@type": "HowToStep", text: "Knead." }],
        },
      ]),
    ).toEqual([
      { title: null, lines: ["Preheat the oven."] },
      { title: "Dough", lines: ["Knead."] },
    ]);
  });

  it("treats a nameless HowToSection as an unnamed group", () => {
    expect(
      asInstructionGroups([
        {
          "@type": "HowToSection",
          itemListElement: [{ "@type": "HowToStep", text: "Stir." }],
        },
      ]),
    ).toEqual([{ title: null, lines: ["Stir."] }]);
  });

  it("returns [] for null/empty input", () => {
    expect(asInstructionGroups(null)).toEqual([]);
    expect(asInstructionGroups([])).toEqual([]);
  });

  it("cleans HTML entities in names and steps", () => {
    expect(
      asInstructionGroups([
        {
          "@type": "HowToSection",
          name: "F&uuml;r den Teig",
          itemListElement: [{ "@type": "HowToStep", text: "R&uuml;hren" }],
        },
      ]),
    ).toEqual([{ title: "Für den Teig", lines: ["Rühren"] }]);
  });
});
```

NOTE: check how `clean()` in `json-ld.ts` handles entities (an `ENTITIES` map exists around line 69). If `&uuml;` is not in the map, adjust the last test to use an entity that IS handled (e.g. `&amp;`) — the point is "names go through the same cleaning as step text", not entity completeness.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/recipe-import.test.ts -t asInstructionGroups`
Expected: FAIL — `asInstructionGroups` is not exported.

- [ ] **Step 3: Implement `asInstructionGroups`**

In `src/lib/recipe-import/json-ld.ts`, directly below `asStringList` (after ~line 153):

```ts
export type InstructionGroup = { title: string | null; lines: string[] };

/**
 * Structure-aware variant of {@link asStringList} for `recipeInstructions`:
 * preserves `HowToSection` boundaries (title = the section's `name`) instead
 * of flattening them away. Loose steps/strings before or between sections
 * accumulate into unnamed groups. A flat step list yields a single
 * `{ title: null }` group, so downstream behavior matches today's exactly.
 */
export function asInstructionGroups(v: unknown): InstructionGroup[] {
  const groups: InstructionGroup[] = [{ title: null, lines: [] }];
  function visit(node: unknown) {
    if (node == null) return;
    if (typeof node === "string") {
      const s = clean(node);
      if (s.length > 0) groups[groups.length - 1].lines.push(s);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      // HowToSection: its name becomes a group title, its steps the lines.
      if (Array.isArray(obj.itemListElement)) {
        const title =
          typeof obj.name === "string" ? asString(obj.name) : null;
        groups.push({ title, lines: [] });
        visit(obj.itemListElement);
        return;
      }
      if (typeof obj.text === "string") {
        visit(obj.text);
        return;
      }
      if (typeof obj.name === "string") {
        visit(obj.name);
        return;
      }
    }
  }
  visit(v);
  return groups.filter((g) => g.title !== null || g.lines.length > 0);
}
```

(`clean` is the module-private cleaner that `asString`/`asStringList` already use — reuse it as they do; `asString(obj.name)` handles the trim-to-null case.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/recipe-import.test.ts`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipe-import/json-ld.ts tests/recipe-import.test.ts
git commit -m "feat(import): preserve HowToSection names when reading recipeInstructions"
```

---

### Task 2: Pre-grouped ingredient parsing in `index.ts`

**Files:**
- Modify: `src/lib/recipe-import/index.ts:1184-1318` (refactor `parseIngredientLinesIntoSections`)
- Test: `tests/recipe-import-matching.test.ts` (has `makeLookups` helper at top)

- [ ] **Step 1: Write the failing tests**

Add to `tests/recipe-import-matching.test.ts` — extend the `@/lib/recipe-import` import with `parseIngredientGroupsIntoSections`:

```ts
describe("parseIngredientGroupsIntoSections", () => {
  it("turns pre-grouped lines into one section per group", () => {
    const out = parseIngredientGroupsIntoSections(
      [
        { title: "Quick Pickled Cabbage", lines: ["1 g Kraut", "2 g Salz"] },
        { title: "Horseradish Sauce", lines: ["3 g Ketchup"] },
      ],
      makeLookups([]),
    );
    expect(out.map((g) => g.title)).toEqual([
      "Quick Pickled Cabbage",
      "Horseradish Sauce",
    ]);
    expect(out[0].ingredients.map((i) => i.name)).toEqual(["Kraut", "Salz"]);
    expect(out[1].ingredients.map((i) => i.name)).toEqual(["Ketchup"]);
  });

  it("keeps an unnamed lead group as the first untitled section", () => {
    const out = parseIngredientGroupsIntoSections(
      [
        { title: null, lines: ["1 g Butter"] },
        { title: "Frosting", lines: ["2 g Zucker"] },
      ],
      makeLookups([]),
    );
    expect(out.map((g) => g.title)).toEqual([null, "Frosting"]);
    expect(out[0].ingredients).toHaveLength(1);
  });

  it("does NOT re-split trusted groups on colon-suffixed lines", () => {
    // In the flat heuristic path "Salz:" would start a new section; inside a
    // structurally-known group it must stay put (and parse or be skipped),
    // never create a section.
    const out = parseIngredientGroupsIntoSections(
      [{ title: "Sauce", lines: ["1 g Ketchup", "Wichtig: gut rühren"] }],
      makeLookups([]),
    );
    expect(out.map((g) => g.title)).toEqual(["Sauce"]);
  });

  it("flat wrapper still detects text headers (behavior unchanged)", () => {
    const out = parseIngredientLinesIntoSections(
      ["1 g Butter", "Frosting:", "2 g Zucker"],
      makeLookups([]),
    );
    expect(out.map((g) => g.title)).toEqual([null, "Frosting"]);
  });
});
```

NOTE on the colon test: the inner `expandIngredientLine`/colon-fallback machinery stays active by design, so "Wichtig: gut rühren" MAY still be promoted via the defensive colon fallback (`parsed.name.includes(":")` → new section from `row.rawText`). Run the test; if it fails because of that inner fallback, the assertion documents real behavior — decide: the trusted-group guarantee only covers `detectSectionHeader` on the raw line (e.g. `"Sauce:"`-shaped lines, ALL-CAPS lines, `--- x ---` lines). In that case replace the second line with `"MARINADE"` (ALL-CAPS — caught only by `detectSectionHeader`, not the inner fallback) and keep the assertion that no new section appears.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/recipe-import-matching.test.ts -t parseIngredientGroupsIntoSections`
Expected: FAIL — `parseIngredientGroupsIntoSections` is not exported.

- [ ] **Step 3: Refactor**

In `src/lib/recipe-import/index.ts`: add the input type next to `ParsedSectionGroup` (~line 1184), convert `parseIngredientLinesIntoSections` into a thin wrapper, move its body into a private `parseGroupedIngredientLines`, and add the public grouped entry point.

```ts
export type PreGroupedLines = {
  /** Group title (null = unnamed lead-in group). */
  title: string | null;
  lines: readonly string[];
};
```

The existing exported function (keep its doc comment) becomes:

```ts
export function parseIngredientLinesIntoSections(
  lines: readonly string[],
  lookups: ParseLookups,
  options: ParseIngredientsOptions = {},
): ParsedSectionGroup[] {
  return parseGroupedIngredientLines(
    [{ title: null, lines }],
    lookups,
    options,
    true,
  );
}

/**
 * Pre-grouped variant for sources whose section boundaries are known from
 * structure (plugin HTML markup) rather than text heuristics. Lines inside a
 * trusted group are NOT run through `detectSectionHeader` — an item that
 * merely looks like a header ("Salz:", ALL-CAPS) cannot break up a group the
 * source explicitly declared. The inner expansion machinery (Optional:,
 * alternativ:, colon fallback) stays active in both modes.
 */
export function parseIngredientGroupsIntoSections(
  groups: readonly PreGroupedLines[],
  lookups: ParseLookups,
  options: ParseIngredientsOptions = {},
): ParsedSectionGroup[] {
  return parseGroupedIngredientLines(groups, lookups, options, false);
}

function parseGroupedIngredientLines(
  inputGroups: readonly PreGroupedLines[],
  lookups: ParseLookups,
  options: ParseIngredientsOptions,
  detectHeaders: boolean,
): ParsedSectionGroup[] {
  // ── setup block: UNCHANGED lines 1202-1211 (knownUnitTokens, splitOpts,
  //    threshold, useFirstWins) ──
  const groups: ParsedSectionGroup[] = [];

  for (const input of inputGroups) {
    // Unnamed non-first input groups continue the current section rather
    // than opening an indistinguishable second untitled one.
    if (input.title !== null || groups.length === 0) {
      groups.push({ title: input.title, ingredients: [] });
    }
    for (const rawLine of input.lines) {
      if (detectHeaders) {
        const header = detectSectionHeader(rawLine);
        if (header) {
          groups.push({ title: header, ingredients: [] });
          continue;
        }
      }
      // ── per-line body: UNCHANGED lines 1220-1308 (the /\p{L}/u guard,
      //    lastPrimaryIndex, expandIngredientLine loop, conjunction split,
      //    matching, alternatives folding, push to currentGroup) ──
    }
  }

  if (groups.length === 0) groups.push({ title: null, ingredients: [] });
  // ── trailing cleanup: UNCHANGED lines 1311-1317 (drop empty unnamed lead
  //    group, applyAlternativeInheritance per group) ──
  return groups;
}
```

The moved body is copy-paste verbatim except for the indentation level — do not edit its logic. The original initializer `[{ title: null, ingredients: [] }]` is replaced by the lazy push above so a titled first input group doesn't leave behind an empty untitled section (the trailing cleanup would also catch it; both paths are equivalent — keep the lazy push, it's clearer).

- [ ] **Step 4: Run the FULL test suite to verify wrapper equivalence**

Run: `npx vitest run`
Expected: PASS — especially `tests/recipe-import-matching.test.ts` (existing flat-path tests at lines 570-630, 981-1161) and `tests/recipe-import.familywall-golden.test.ts`, which both exercise `parseIngredientLinesIntoSections`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipe-import/index.ts tests/recipe-import-matching.test.ts
git commit -m "feat(import): pre-grouped ingredient parsing variant for structural sources"
```

---

### Task 3: HTML ingredient-group extractors (`html-groups.ts`)

**Files:**
- Create: `src/lib/recipe-import/html-groups.ts`
- Test: `tests/html-groups.test.ts`
- Modify: `package.json` (new dep)

- [ ] **Step 1: Install the parser**

```bash
npm install node-html-parser
```

Expected: `node-html-parser` appears under `dependencies` (NOT devDependencies).

- [ ] **Step 2: Write the failing tests**

Create `tests/html-groups.test.ts`:

```ts
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
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/html-groups.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `html-groups.ts`**

Create `src/lib/recipe-import/html-groups.ts`:

```ts
/**
 * Ingredient-group extraction from recipe-plugin HTML markup.
 *
 * schema.org's `recipeIngredient` is a flat string list — group headers
 * ("For the sauce") exist only in the plugin's HTML. The extractors below
 * read those boundaries for the three dominant WordPress recipe plugins.
 * Extracted item text is used for ALIGNMENT ONLY: `alignHtmlGroupsToLines`
 * maps the titles onto the canonical JSON-LD strings and refuses on any
 * count mismatch, so a wrong parse can never corrupt an import — at worst
 * the grouping is skipped.
 */
import { parse, type HTMLElement, NodeType } from "node-html-parser";

export type HtmlIngredientGroup = {
  /** Group heading text (null = unnamed lead group before the first heading). */
  title: string | null;
  items: string[];
};

export function extractIngredientGroupsFromHtml(
  html: string,
): HtmlIngredientGroup[] | null {
  let root: HTMLElement;
  try {
    root = parse(html);
  } catch {
    return null;
  }
  for (const extract of [extractWprm, extractTasty, extractMvCreate]) {
    let groups: HtmlIngredientGroup[] | null;
    try {
      groups = extract(root);
    } catch {
      groups = null;
    }
    if (!groups) continue;
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    const hasTitle = groups.some((g) => g.title !== null);
    // A single untitled blob carries no grouping information.
    if (total === 0 || !hasTitle) continue;
    return groups;
  }
  return null;
}

/**
 * Map plugin-extracted group boundaries onto the canonical JSON-LD
 * ingredient strings. The HTML contributes titles and counts only — the
 * JSON-LD text is what the ingredient parser is tuned for. Returns null
 * whenever the counts disagree; grouping is then skipped, never guessed.
 */
export function alignHtmlGroupsToLines(
  groups: readonly HtmlIngredientGroup[],
  lines: readonly string[],
): { title: string | null; lines: string[] }[] | null {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (total === 0 || total !== lines.length) return null;
  const out: { title: string | null; lines: string[] }[] = [];
  let offset = 0;
  for (const g of groups) {
    out.push({
      title: g.title,
      lines: lines.slice(offset, offset + g.items.length),
    });
    offset += g.items.length;
  }
  return out;
}

// ── shared helpers ──

const WS = /\s+/g;

function textOf(el: HTMLElement): string {
  return el.text.replace(WS, " ").trim();
}

function elementChildren(el: HTMLElement): HTMLElement[] {
  return el.childNodes.filter(
    (n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE,
  );
}

function tagOf(el: HTMLElement): string {
  return (el.rawTagName ?? "").toUpperCase();
}

const HEADING_TAGS = new Set(["H2", "H3", "H4", "H5"]);

/**
 * Walk a container whose structure alternates heading elements and <ul>/<ol>
 * lists (possibly nested in wrapper divs): each accepted heading starts a
 * new group, each list contributes its <li>s to the current group. Items
 * before the first heading land in an unnamed lead group.
 */
function groupsFromHeadingsAndLists(
  container: HTMLElement,
  acceptHeading: (el: HTMLElement) => boolean,
): HtmlIngredientGroup[] {
  const groups: HtmlIngredientGroup[] = [{ title: null, items: [] }];
  const walk = (el: HTMLElement) => {
    for (const child of elementChildren(el)) {
      const tag = tagOf(child);
      if (HEADING_TAGS.has(tag)) {
        if (acceptHeading(child)) {
          groups.push({ title: textOf(child) || null, items: [] });
        }
        continue;
      }
      if (tag === "UL" || tag === "OL") {
        for (const li of elementChildren(child)) {
          if (tagOf(li) !== "LI") continue;
          const t = textOf(li);
          if (t.length > 0) groups[groups.length - 1].items.push(t);
        }
        continue;
      }
      walk(child);
    }
  };
  walk(container);
  if (
    groups.length > 1 &&
    groups[0].title === null &&
    groups[0].items.length === 0
  ) {
    groups.shift();
  }
  return groups;
}

// ── WP Recipe Maker ──
// <div class="wprm-recipe-ingredient-group">
//   <h4 class="wprm-recipe-group-name wprm-recipe-ingredient-group-name">…</h4>
//   <ul><li class="wprm-recipe-ingredient">
//     <span class="wprm-recipe-ingredient-amount">…</span> …
// CAUTION: `wprm-recipe-group-name` is ALSO on instruction-group headings —
// only the ingredient-group container scopes correctly.
function extractWprm(root: HTMLElement): HtmlIngredientGroup[] | null {
  // Scope to the first card so a second card or print/fallback copy can't
  // double the groups.
  const container = root.querySelector(".wprm-recipe-container") ?? root;
  const groupEls = container.querySelectorAll(".wprm-recipe-ingredient-group");
  if (groupEls.length === 0) return null;
  return groupEls.map((groupEl) => {
    const titleEl = groupEl.querySelector(".wprm-recipe-ingredient-group-name");
    const items = groupEl
      .querySelectorAll("li.wprm-recipe-ingredient")
      .map(wprmIngredientText)
      .filter((s) => s.length > 0);
    return { title: titleEl ? textOf(titleEl) || null : null, items };
  });
}

function wprmIngredientText(li: HTMLElement): string {
  // The amount/unit/name/notes spans are the content; everything else in the
  // <li> is checkbox UI noise.
  const parts = li
    .querySelectorAll(
      ".wprm-recipe-ingredient-amount, .wprm-recipe-ingredient-unit, .wprm-recipe-ingredient-name, .wprm-recipe-ingredient-notes",
    )
    .map(textOf)
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts.join(" ") : textOf(li);
}

// ── Tasty Recipes ──
// <div class="tasty-recipes-ingredients">
//   <div class="tasty-recipes-ingredients-header"><h3>Ingredients</h3></div>
//   <div class="tasty-recipes-ingredients-body">
//     <ul><li data-tr-ingredient-checkbox>…</li></ul>
//     <h4>Group</h4><ul>…</ul>
function extractTasty(root: HTMLElement): HtmlIngredientGroup[] | null {
  const container =
    root.querySelector(".tasty-recipes-ingredients-body") ??
    root.querySelector(".tasty-recipes-ingredients");
  if (!container) return null;
  // Older themes lack the -body wrapper; the card's own "Ingredients"
  // heading then sits inside the header div — skip that subtree.
  return groupsFromHeadingsAndLists(
    container,
    (h) => h.closest(".tasty-recipes-ingredients-header") === null,
  );
}

// ── Mediavine Create ──
// <div class="mv-create-ingredients">
//   <h3 class="mv-create-ingredients-title">Ingredients</h3>
//   <h4>Group</h4><ul><li>…</li></ul>
function extractMvCreate(root: HTMLElement): HtmlIngredientGroup[] | null {
  const container = root.querySelector(".mv-create-ingredients");
  if (!container) return null;
  return groupsFromHeadingsAndLists(
    container,
    (h) => !h.classList.contains("mv-create-ingredients-title"),
  );
}
```

API NOTE for the implementer: verify against the installed `node-html-parser` version — `NodeType.ELEMENT_NODE` export, `rawTagName` vs `tagName` (in current versions `tagName` returns uppercase; `rawTagName` preserves source case), `classList.contains`, and `closest()`. The tests will catch any mismatch; adjust the helpers (`elementChildren`, `tagOf`), not the tests.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/html-groups.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/recipe-import/html-groups.ts tests/html-groups.test.ts
git commit -m "feat(import): extract ingredient groups from WPRM/Tasty/Create HTML markup"
```

---

### Task 4: Wire both signals into the import flow

**Files:**
- Modify: `src/lib/recipe-import/index.ts:1533-1545` (inside `importRecipeFromUrl`) + new exported `buildImportSections`
- Test: `tests/import-sections.test.ts` (new)

- [ ] **Step 1: Write the failing integration test**

Create `tests/import-sections.test.ts`. It drives the full post-fetch pipeline (JSON-LD extraction → section building → merge) over a fixture modeled on the cozypeachkitchen page, with hand-built lookups (no DB):

```ts
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
```

NOTE: `rawText` assertion — check the `ImportedIngredient` field name used for the source line (`rawText` per `parseIngredientLinesIntoSections`, index.ts:1300). If the parse of "1/2 medium red cabbage" splits notes differently, assert on `ingredientGroups[0].ingredients[0]` fields that are stable (e.g. `name` containing "cabbage") instead — the point is JSON-LD text (with "1/2 medium"), not HTML text ("red cabbage"), reached the parser.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/import-sections.test.ts`
Expected: FAIL — `buildImportSections` is not exported.

- [ ] **Step 3: Implement `buildImportSections` and wire it in**

In `src/lib/recipe-import/index.ts`:

Extend the json-ld import at the top of the file with `asInstructionGroups` and the `JsonLdRecipe` type (check what's already imported), and add:

```ts
import {
  alignHtmlGroupsToLines,
  extractIngredientGroupsFromHtml,
} from "./html-groups";
```

Add above `importRecipeFromUrl` (~line 1488):

```ts
/**
 * Build ingredient + instruction section groups for a URL import from the
 * two available signals:
 *
 * - Ingredients: schema.org has no group concept, so boundaries come from
 *   recipe-plugin HTML markup when present. The JSON-LD strings stay
 *   canonical — HTML contributes titles and counts only, and only when the
 *   counts line up exactly. Otherwise: today's flat text-heuristic path.
 * - Instructions: JSON-LD `HowToSection` names are authoritative when
 *   present; otherwise the text-heuristic header splitter runs as before.
 */
export function buildImportSections(
  recipe: JsonLdRecipe,
  html: string,
  lookups: ParseLookups,
): {
  ingredientGroups: ParsedSectionGroup[];
  instructionGroups: ParsedInstructionGroup[];
} {
  const ingredientStrings = asStringList(recipe.recipeIngredient);
  const htmlGroups = extractIngredientGroupsFromHtml(html);
  const aligned = htmlGroups
    ? alignHtmlGroupsToLines(htmlGroups, ingredientStrings)
    : null;
  const ingredientGroups = aligned
    ? parseIngredientGroupsIntoSections(aligned, lookups)
    : parseIngredientLinesIntoSections(ingredientStrings, lookups);

  const rawInstructionGroups = asInstructionGroups(recipe.recipeInstructions);
  const instructionGroups: ParsedInstructionGroup[] = rawInstructionGroups.some(
    (g) => g.title !== null,
  )
    ? rawInstructionGroups
    : parseInstructionsIntoSections(
        rawInstructionGroups.flatMap((g) => g.lines),
      );

  return { ingredientGroups, instructionGroups };
}
```

Then replace the body of `importRecipeFromUrl` lines 1523-1545 (from `const ingredientStrings = …` through the `mergeIngredientAndInstructionSections(...)` call) with:

```ts
  const unitLookup = buildUnitLookup();
  const ingredientLookup = buildIngredientLookup();
  const ingredientCatalog = buildIngredientCatalog();

  // Section-aware: structural signals first (plugin HTML ingredient groups,
  // JSON-LD HowToSection names), text heuristics as fallback. Matching
  // titles land in the same merged section; see buildImportSections.
  const { ingredientGroups, instructionGroups } = buildImportSections(
    recipe,
    html,
    {
      units: unitLookup,
      ingredients: ingredientLookup,
      ingredientCatalog,
    },
  );
  const merged = mergeIngredientAndInstructionSections(
    ingredientGroups,
    instructionGroups,
    instructionsToMarkdown,
  );
```

(Everything after — photo download, return — unchanged.)

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipe-import/index.ts tests/import-sections.test.ts
git commit -m "feat(import): detect recipe sections from plugin HTML and HowToSection data"
```

---

### Task 5: Verify against the real page and finish

- [ ] **Step 1: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed (new runtime dep must survive the production build).

- [ ] **Step 2: Manual end-to-end against the live page**

Start the dev server and import `https://cozypeachkitchen.com/veggie-reuben-with-quick-pickled-cabbage/` through the UI (or POST to `/api/v1/recipes/import-url`). Expected result: 4 sections — "Quick Pickled Cabbage" (7 ingredients + 2 steps), "Horseradish Sauce" (5 + 1), "Vegetarian Reuben" (7, no steps), "Vegetarian Reubens" (0 ingredients, assembly steps). Spot-check one regression URL that previously imported fine (any chefkoch.de recipe) to confirm flat imports are unchanged.

- [ ] **Step 3: Final commit if manual testing surfaced fixes**

```bash
git add -A && git commit -m "fix(import): <whatever the manual test surfaced>"
```
