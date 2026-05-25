# Recipe Search + Diet Filter + Probable-Diet Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tokenized Google-style search (quotes, `+`/`-`, `zutat:`, typo tolerance), a 3-state diet filter, and a "Wahrscheinlich Vegetarisch/Vegan" badge tier for recipes whose untagged ingredients still allow a confident guess.

**Architecture:** All filtering moves into `listRecipes` (server-side). A new `lib/recipes/search.ts` module parses the raw `?q=` into a `ParsedQuery`, then scores each recipe against a per-recipe folded index. `deriveDiet` grows a `confidence` field; `DietBadge` branches on it.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM + better-sqlite3, TypeScript, Vitest, Tailwind, Radix UI (Popover, ToggleGroup).

**Spec:** `docs/superpowers/specs/2026-05-25-recipe-search-and-diet-filter-design.md`

---

## File Structure

**New:**
- `src/lib/recipes/search.ts` — parser (`parseQuery`), folder (`fold`), scorer (`scoreToken`), recipe matcher (`matchRecipe`).
- `src/components/recipes/diet-filter.tsx` — 3-segment toggle.
- `tests/search-parser.test.ts`
- `tests/search-scoring.test.ts`
- `tests/recipes-service.test.ts`

**Modified:**
- `src/lib/recipes/diet.ts` — add `DietConfidence` and `confidence` field.
- `src/lib/recipes/types.ts` — add `dietConfidence` to `RecipeListItem`/`RecipeView`.
- `src/lib/recipes/service.ts` — pipeline rewrite, ingredient-index loader, `dietConfidence` projection.
- `src/components/recipes/recipe-search.tsx` — placeholder + syntax help popover.
- `src/components/recipes/recipe-grid.tsx` — pure renderer, updated empty state.
- `src/components/recipes/diet-badge.tsx` — confidence-aware rendering.
- `src/app/rezepte/page.tsx` — forward all four search params, render `<DietFilter />`.
- `src/app/rezepte/[id]/page.tsx` — pass `dietConfidence` to badge.
- `tests/diet.test.ts` — extended cases for new confidence tier.

---

## Task 1: Extend `deriveDiet` with confidence tier

**Files:**
- Modify: `src/lib/recipes/diet.ts`
- Test: `tests/diet.test.ts`

- [ ] **Step 1: Replace the test file with the extended cases**

`tests/diet.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { deriveDiet } from "@/lib/recipes/diet";

describe("deriveDiet", () => {
  it("all vegan ingredients → definite vegan + vegetarian", () => {
    expect(deriveDiet(["vegan", "vegan", "vegan"])).toEqual({
      isVegan: true,
      isVegetarian: true,
      confidence: "definite",
    });
  });

  it("mix of vegan + vegetarian → definite vegetarian only", () => {
    expect(deriveDiet(["vegan", "vegetarian", "vegan"])).toEqual({
      isVegan: false,
      isVegetarian: true,
      confidence: "definite",
    });
  });

  it("any meat ingredient → definite neither (even with nulls)", () => {
    expect(deriveDiet(["vegan", "meat", null])).toEqual({
      isVegan: false,
      isVegetarian: false,
      confidence: "definite",
    });
  });

  it("nulls with all tagged vegan → probable vegan", () => {
    expect(deriveDiet(["vegan", null, "vegan"])).toEqual({
      isVegan: true,
      isVegetarian: true,
      confidence: "probable",
    });
  });

  it("nulls with at least one tagged vegetarian → probable vegetarian", () => {
    expect(deriveDiet(["vegan", null, "vegetarian"])).toEqual({
      isVegan: false,
      isVegetarian: true,
      confidence: "probable",
    });
  });

  it("only nulls (no tagged signal) → unknown", () => {
    expect(deriveDiet([null, null, null])).toEqual({
      isVegan: null,
      isVegetarian: null,
      confidence: "unknown",
    });
  });

  it("empty list → vacuous definite vegan", () => {
    expect(deriveDiet([])).toEqual({
      isVegan: true,
      isVegetarian: true,
      confidence: "definite",
    });
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- tests/diet.test.ts`
Expected: 6 of 7 fail because `confidence` is missing from the output.

- [ ] **Step 3: Rewrite `deriveDiet` with confidence**

Replace the contents of `src/lib/recipes/diet.ts` with:

```typescript
/**
 * Recipe-level diet derived from ingredient-level `dietary_class` tags.
 *
 *  - `definite`: every contributing ingredient is tagged, OR a definite
 *    meat ruling.
 *  - `probable`: some ingredients are untagged but enough are tagged to
 *    make a best-effort claim (vegan/vegetarian only — never meat).
 *  - `unknown`: nothing tagged → no claim. Badge stays hidden.
 */
export type DietConfidence = "definite" | "probable" | "unknown";

export type RecipeDiet = {
  isVegan: boolean | null;
  isVegetarian: boolean | null;
  confidence: DietConfidence;
};

export type IngredientDietaryClass = "vegan" | "vegetarian" | "meat" | null;

export function deriveDiet(classes: IngredientDietaryClass[]): RecipeDiet {
  let hasMeat = false;
  let hasVegetarian = false;
  let hasUnknown = false;
  let hasVegan = false;
  for (const c of classes) {
    if (c === "meat") hasMeat = true;
    else if (c === "vegetarian") hasVegetarian = true;
    else if (c === "vegan") hasVegan = true;
    else hasUnknown = true;
  }
  if (hasMeat) {
    return { isVegan: false, isVegetarian: false, confidence: "definite" };
  }
  if (!hasUnknown) {
    if (hasVegetarian) {
      return { isVegan: false, isVegetarian: true, confidence: "definite" };
    }
    return { isVegan: true, isVegetarian: true, confidence: "definite" };
  }
  // hasUnknown && !hasMeat
  if (!hasVegan && !hasVegetarian) {
    return { isVegan: null, isVegetarian: null, confidence: "unknown" };
  }
  if (hasVegetarian) {
    return { isVegan: false, isVegetarian: true, confidence: "probable" };
  }
  return { isVegan: true, isVegetarian: true, confidence: "probable" };
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test -- tests/diet.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipes/diet.ts tests/diet.test.ts
git commit -m "Diet: add confidence tier (definite/probable/unknown)"
```

---

## Task 2: Build query parser

**Files:**
- Create: `src/lib/recipes/search.ts`
- Test: `tests/search-parser.test.ts`

- [ ] **Step 1: Write the failing test file**

`tests/search-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseQuery, fold } from "@/lib/recipes/search";

describe("fold", () => {
  it("lowercases and strips diacritics", () => {
    expect(fold("Möhre")).toBe("mohre");
    expect(fold("Äpfel")).toBe("apfel");
  });
  it("replaces ß with ss", () => {
    expect(fold("Straße")).toBe("strasse");
  });
});

describe("parseQuery", () => {
  it("returns empty tokens for empty/whitespace input", () => {
    expect(parseQuery("")).toEqual({ tokens: [] });
    expect(parseQuery("   ")).toEqual({ tokens: [] });
  });

  it("splits unprefixed tokens on whitespace", () => {
    expect(parseQuery("tomate basilikum")).toEqual({
      tokens: [
        { kind: "title", text: "tomate", isPhrase: false, polarity: "include" },
        { kind: "title", text: "basilikum", isPhrase: false, polarity: "include" },
      ],
    });
  });

  it("folds tokens (diacritics, ß, case)", () => {
    expect(parseQuery("Möhre Straße")).toEqual({
      tokens: [
        { kind: "title", text: "mohre", isPhrase: false, polarity: "include" },
        { kind: "title", text: "strasse", isPhrase: false, polarity: "include" },
      ],
    });
  });

  it("treats quoted spans as a single phrase token", () => {
    expect(parseQuery('"rote linsen"')).toEqual({
      tokens: [
        { kind: "title", text: "rote linsen", isPhrase: true, polarity: "include" },
      ],
    });
  });

  it("handles an unterminated quote as if closed at end of input", () => {
    expect(parseQuery('"rote linsen')).toEqual({
      tokens: [
        { kind: "title", text: "rote linsen", isPhrase: true, polarity: "include" },
      ],
    });
  });

  it("supports + and - polarity prefixes", () => {
    expect(parseQuery("+pasta -nudeln")).toEqual({
      tokens: [
        { kind: "title", text: "pasta", isPhrase: false, polarity: "include" },
        { kind: "title", text: "nudeln", isPhrase: false, polarity: "exclude" },
      ],
    });
  });

  it("supports zutat: field prefix (case-insensitive)", () => {
    expect(parseQuery("ZUTAT:Basilikum")).toEqual({
      tokens: [
        { kind: "zutat", text: "basilikum", isPhrase: false, polarity: "include" },
      ],
    });
  });

  it("supports zutat: with quoted phrase", () => {
    expect(parseQuery('zutat:"rote linsen"')).toEqual({
      tokens: [
        { kind: "zutat", text: "rote linsen", isPhrase: true, polarity: "include" },
      ],
    });
  });

  it("supports -zutat: exclusion", () => {
    expect(parseQuery("-zutat:fleisch")).toEqual({
      tokens: [
        { kind: "zutat", text: "fleisch", isPhrase: false, polarity: "exclude" },
      ],
    });
  });

  it("drops empty tokens after stripping", () => {
    expect(parseQuery('- "" zutat: pasta')).toEqual({
      tokens: [
        { kind: "title", text: "pasta", isPhrase: false, polarity: "include" },
      ],
    });
  });

  it("mixes everything together", () => {
    const result = parseQuery('pasta "rote linsen" +tomate -nudeln zutat:basilikum -zutat:fleisch');
    expect(result.tokens).toEqual([
      { kind: "title", text: "pasta", isPhrase: false, polarity: "include" },
      { kind: "title", text: "rote linsen", isPhrase: true, polarity: "include" },
      { kind: "title", text: "tomate", isPhrase: false, polarity: "include" },
      { kind: "title", text: "nudeln", isPhrase: false, polarity: "exclude" },
      { kind: "zutat", text: "basilikum", isPhrase: false, polarity: "include" },
      { kind: "zutat", text: "fleisch", isPhrase: false, polarity: "exclude" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- tests/search-parser.test.ts`
Expected: All fail because `src/lib/recipes/search.ts` does not exist.

- [ ] **Step 3: Implement the parser**

Create `src/lib/recipes/search.ts`:

```typescript
/**
 * Recipe search: token-and-score query parser used by `listRecipes`.
 *
 * Grammar:
 *   token   := [polarity] [field-prefix] (phrase | word)
 *   polarity := "+" | "-"          (default: include)
 *   field-prefix := "zutat:"       (case-insensitive; absent = title field)
 *   phrase  := '"' .*? ('"' | EOL)
 *   word    := non-whitespace, non-quote
 *
 * All token text is ASCII-folded and lowercased so a query like "mohre"
 * matches "Möhre". The same folding runs on each indexed field at match
 * time. See spec §1 in
 * docs/superpowers/specs/2026-05-25-recipe-search-and-diet-filter-design.md.
 */

export type ParsedToken = {
  kind: "title" | "zutat";
  text: string;
  isPhrase: boolean;
  polarity: "include" | "exclude";
};

export type ParsedQuery = { tokens: ParsedToken[] };

export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

const FIELD_PREFIX = "zutat:";

export function parseQuery(input: string): ParsedQuery {
  const tokens: ParsedToken[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    // Skip whitespace.
    while (i < n && /\s/.test(input[i])) i++;
    if (i >= n) break;

    let polarity: "include" | "exclude" = "include";
    if (input[i] === "+") {
      i++;
    } else if (input[i] === "-") {
      polarity = "exclude";
      i++;
    }

    let kind: "title" | "zutat" = "title";
    if (input.slice(i, i + FIELD_PREFIX.length).toLowerCase() === FIELD_PREFIX) {
      kind = "zutat";
      i += FIELD_PREFIX.length;
    }

    let raw: string;
    let isPhrase = false;
    if (input[i] === '"') {
      isPhrase = true;
      i++;
      const start = i;
      while (i < n && input[i] !== '"') i++;
      raw = input.slice(start, i);
      if (i < n && input[i] === '"') i++;
    } else {
      const start = i;
      while (i < n && !/\s/.test(input[i])) i++;
      raw = input.slice(start, i);
    }

    const text = fold(raw.trim());
    if (text.length === 0) continue;
    tokens.push({ kind, text, isPhrase, polarity });
  }
  return { tokens };
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test -- tests/search-parser.test.ts`
Expected: 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipes/search.ts tests/search-parser.test.ts
git commit -m "Recipe search: query parser with tokens, phrases, +/- and zutat: prefix"
```

---

## Task 3: Build scorer + matcher

**Files:**
- Modify: `src/lib/recipes/search.ts`
- Test: `tests/search-scoring.test.ts`

- [ ] **Step 1: Write the failing test file**

`tests/search-scoring.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { scoreToken, matchRecipe, parseQuery } from "@/lib/recipes/search";

describe("scoreToken", () => {
  const tok = (text: string, isPhrase = false) =>
    ({ kind: "title" as const, text, isPhrase, polarity: "include" as const });

  it("exact equality → 100", () => {
    expect(scoreToken(tok("tomate"), "tomate")).toBe(100);
  });

  it("prefix match → 80", () => {
    expect(scoreToken(tok("toma"), "tomatensuppe")).toBe(80);
  });

  it("substring match → 60", () => {
    expect(scoreToken(tok("aten"), "tomatensuppe")).toBe(60);
  });

  it("Levenshtein within threshold → 40 minus 5×distance", () => {
    // "tomte" vs "tomate" — distance 1, threshold max(1, floor(5/5))=1.
    expect(scoreToken(tok("tomte"), "tomate")).toBe(35);
  });

  it("Levenshtein beyond threshold → 0", () => {
    // "xyz" vs "tomate" — distance >> threshold.
    expect(scoreToken(tok("xyz"), "tomate")).toBe(0);
  });

  it("multi-word field uses max-per-word", () => {
    // "basilikum thai-basilikum" — token "thai" prefixes the second word.
    expect(scoreToken(tok("thai"), "basilikum thai-basilikum")).toBe(60);
  });

  it("phrase → 80 on contiguous substring of full field", () => {
    expect(
      scoreToken(tok("rote linsen", true), "suppe mit rote linsen und reis"),
    ).toBe(80);
  });

  it("phrase → 0 when not contiguous", () => {
    expect(
      scoreToken(tok("rote linsen", true), "rote suppe mit linsen"),
    ).toBe(0);
  });
});

describe("matchRecipe", () => {
  const rec = (title: string, ingredients = "") => ({
    titleFolded: title,
    ingredientsFolded: ingredients,
  });

  it("empty query matches every recipe with rank 0", () => {
    expect(matchRecipe(parseQuery(""), rec("tomatensuppe"))).toEqual({
      passes: true,
      rank: 0,
    });
  });

  it("AND across include tokens", () => {
    const r = matchRecipe(parseQuery("tomate suppe"), rec("tomatensuppe"));
    expect(r.passes).toBe(true);
    expect(r.rank).toBeGreaterThan(0);
  });

  it("AND fails when one token misses", () => {
    expect(
      matchRecipe(parseQuery("tomate pizza"), rec("tomatensuppe")).passes,
    ).toBe(false);
  });

  it("exclude token vetoes the recipe", () => {
    expect(
      matchRecipe(parseQuery("tomate -suppe"), rec("tomatensuppe")).passes,
    ).toBe(false);
  });

  it("zutat: targets the ingredient field only", () => {
    const r = matchRecipe(parseQuery("zutat:basilikum"), rec("tomatensuppe", "basilikum tomate"));
    expect(r.passes).toBe(true);
  });

  it("zutat: misses when only present in title", () => {
    expect(
      matchRecipe(parseQuery("zutat:tomate"), rec("tomatensuppe", "")).passes,
    ).toBe(false);
  });

  it("ASCII folding lets mohre match mohre (input was Möhre)", () => {
    expect(
      matchRecipe(parseQuery("mohre"), rec("mohrensuppe")).passes,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- tests/search-scoring.test.ts`
Expected: All fail because `scoreToken` and `matchRecipe` are not exported.

- [ ] **Step 3: Append scorer + matcher to `src/lib/recipes/search.ts`**

Append (after the existing `parseQuery` definition):

```typescript
export type RecipeSearchIndex = {
  titleFolded: string;
  ingredientsFolded: string;
};

export type MatchResult = { passes: boolean; rank: number };

function levenshtein(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function scoreWord(tokenText: string, word: string): number {
  if (word === tokenText) return 100;
  if (word.startsWith(tokenText)) return 80;
  if (word.includes(tokenText)) return 60;
  const cap = Math.max(1, Math.floor(tokenText.length / 5));
  const d = levenshtein(tokenText, word, cap);
  if (d <= cap) return 40 - 5 * d;
  return 0;
}

export function scoreToken(token: ParsedToken, fieldFolded: string): number {
  if (token.isPhrase) {
    return fieldFolded.includes(token.text) ? 80 : 0;
  }
  let best = 0;
  for (const word of fieldFolded.split(/\s+/)) {
    if (word.length === 0) continue;
    const s = scoreWord(token.text, word);
    if (s > best) best = s;
    if (best === 100) break;
  }
  return best;
}

export function matchRecipe(
  query: ParsedQuery,
  index: RecipeSearchIndex,
): MatchResult {
  let rank = 0;
  for (const token of query.tokens) {
    const field =
      token.kind === "zutat" ? index.ingredientsFolded : index.titleFolded;
    const score = scoreToken(token, field);
    if (token.polarity === "exclude") {
      if (score > 0) return { passes: false, rank: 0 };
    } else {
      if (score === 0) return { passes: false, rank: 0 };
      rank += score;
    }
  }
  return { passes: true, rank };
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test -- tests/search-scoring.test.ts`
Expected: 15 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipes/search.ts tests/search-scoring.test.ts
git commit -m "Recipe search: scorer with exact/prefix/substring/Levenshtein tiers"
```

---

## Task 4: Extend types

**Files:**
- Modify: `src/lib/recipes/types.ts`

- [ ] **Step 1: Add `dietConfidence` to view types**

Edit `src/lib/recipes/types.ts`. Find:

```typescript
export type RecipeListItem = {
  id: number;
  title: string;
  description: string | null;
  photoPath: string | null;
  servings: number;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  tags: string[];
  /** Derived from non-optional ingredients' dietary_class. `null` = unknown. */
  isVegan: boolean | null;
  isVegetarian: boolean | null;
};
```

Replace with:

```typescript
import type { DietConfidence } from "./diet.ts";

export type RecipeListItem = {
  id: number;
  title: string;
  description: string | null;
  photoPath: string | null;
  servings: number;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  tags: string[];
  /** Derived from non-optional ingredients' dietary_class. `null` = unknown. */
  isVegan: boolean | null;
  isVegetarian: boolean | null;
  /** "definite" vs "probable" — drives the "Wahrscheinlich …" badge tier. */
  dietConfidence: DietConfidence;
};
```

Then find:

```typescript
  /** Derived from non-optional ingredients' dietary_class. `null` = unknown. */
  isVegan: boolean | null;
  isVegetarian: boolean | null;
  createdAt: number;
  updatedAt: number;
};
```

Replace with:

```typescript
  /** Derived from non-optional ingredients' dietary_class. `null` = unknown. */
  isVegan: boolean | null;
  isVegetarian: boolean | null;
  dietConfidence: DietConfidence;
  createdAt: number;
  updatedAt: number;
};
```

- [ ] **Step 2: Verify the typechecker**

Run: `npm run typecheck`
Expected: Errors reported in `service.ts` because the projected objects don't include `dietConfidence` yet. (That's fixed in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/recipes/types.ts
git commit -m "Recipe types: add dietConfidence to list + view items"
```

---

## Task 5: Service: project `dietConfidence` + accept `diet` option

**Files:**
- Modify: `src/lib/recipes/service.ts`

- [ ] **Step 1: Extend `ListRecipesOptions`**

In `src/lib/recipes/service.ts`, find:

```typescript
export type ListRecipesOptions = {
  query?: string;
  /** Recipe must carry every tag in this list. */
  mustTags?: string[];
  /** Recipe must carry none of the tags in this list. */
  notTags?: string[];
};
```

Replace with:

```typescript
export type ListRecipesOptions = {
  query?: string;
  /** Recipe must carry every tag in this list. */
  mustTags?: string[];
  /** Recipe must carry none of the tags in this list. */
  notTags?: string[];
  /** Diet filter. "vegetarian" includes definite+probable vegetarian (and
   *  vegan). "vegan" includes definite+probable vegan. Recipes whose diet
   *  is `unknown` are excluded for any non-empty filter. */
  diet?: "vegetarian" | "vegan";
};
```

- [ ] **Step 2: Project `dietConfidence` from `listRecipes`**

In `listRecipes`, find the return block:

```typescript
    return [
      {
        id: r.id,
        title: r.title,
        description: r.description,
        photoPath: r.photoPath,
        servings: r.servings,
        prepTimeMin: r.prepTimeMin,
        cookTimeMin: r.cookTimeMin,
        tags: recipeTags,
        isVegan: diet.isVegan,
        isVegetarian: diet.isVegetarian,
      },
    ];
```

Replace with:

```typescript
    return [
      {
        id: r.id,
        title: r.title,
        description: r.description,
        photoPath: r.photoPath,
        servings: r.servings,
        prepTimeMin: r.prepTimeMin,
        cookTimeMin: r.cookTimeMin,
        tags: recipeTags,
        isVegan: diet.isVegan,
        isVegetarian: diet.isVegetarian,
        dietConfidence: diet.confidence,
      },
    ];
```

Then find the fallback initializer just above:

```typescript
    const diet = dietByRecipe.get(r.id) ?? { isVegan: true, isVegetarian: true };
```

Replace with:

```typescript
    const diet = dietByRecipe.get(r.id) ?? {
      isVegan: true,
      isVegetarian: true,
      confidence: "definite" as const,
    };
```

- [ ] **Step 3: Project `dietConfidence` from `getRecipe`**

In `getRecipe`, find:

```typescript
  const diet = deriveDiet(
    ingredients.filter((i) => !i.isOptional).map((i) => i.dietaryClass),
  );

  return {
    id: head.id,
    title: head.title,
    description: head.description,
    photoPath: head.photoPath,
    sourceUrl: head.sourceUrl,
    servings: head.servings,
    prepTimeMin: head.prepTimeMin,
    cookTimeMin: head.cookTimeMin,
    tags,
    isVegan: diet.isVegan,
    isVegetarian: diet.isVegetarian,
```

Replace with:

```typescript
  const diet = deriveDiet(
    ingredients.filter((i) => !i.isOptional).map((i) => i.dietaryClass),
  );

  return {
    id: head.id,
    title: head.title,
    description: head.description,
    photoPath: head.photoPath,
    sourceUrl: head.sourceUrl,
    servings: head.servings,
    prepTimeMin: head.prepTimeMin,
    cookTimeMin: head.cookTimeMin,
    tags,
    isVegan: diet.isVegan,
    isVegetarian: diet.isVegetarian,
    dietConfidence: diet.confidence,
```

- [ ] **Step 4: Run typecheck and existing tests**

Run: `npm run typecheck && npm test`
Expected: All passes. Other code still works because `diet` filter isn't wired into the pipeline yet — it's just accepted on the options shape.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipes/service.ts
git commit -m "Recipe service: project dietConfidence, accept diet option"
```

---

## Task 6: Service: pipeline rewrite

This task replaces the SQL-LIKE path in `listRecipes` with the new parser-driven scoring pipeline, moves tag must/not filtering server-side, and applies the diet filter.

**Files:**
- Modify: `src/lib/recipes/service.ts`
- Test: `tests/recipes-service.test.ts`

- [ ] **Step 1: Write the service integration test**

Create `tests/recipes-service.test.ts`:

```typescript
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-recipes-service-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  const tmpDb = drizzle(sqlite);
  migrate(tmpDb, { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

type Ids = {
  tomatensuppe: number;
  spaghettiBolognese: number;
  apfelkuchen: number;
  unknownRecipe: number;
};

async function seed(): Promise<Ids> {
  const { db } = await import("@/db");
  const {
    ingredient,
    ingredientAlias,
    recipe,
    recipeIngredient,
    recipeSection,
    recipeTag,
    tag,
  } = await import("@/db/schema");

  db.delete(recipeTag).run();
  db.delete(recipeIngredient).run();
  db.delete(recipeSection).run();
  db.delete(recipe).run();
  db.delete(tag).run();
  db.delete(ingredientAlias).run();
  db.delete(ingredient).run();

  const tomate = db
    .insert(ingredient)
    .values({ name: "Tomate", dietaryClass: "vegan" })
    .returning({ id: ingredient.id })
    .all()[0].id;
  db.insert(ingredientAlias)
    .values({ ingredientId: tomate, name: "Strauchtomate" })
    .run();
  const basilikum = db
    .insert(ingredient)
    .values({ name: "Basilikum", dietaryClass: "vegan" })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const hack = db
    .insert(ingredient)
    .values({ name: "Hackfleisch", dietaryClass: "meat" })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const apfel = db
    .insert(ingredient)
    .values({ name: "Apfel", dietaryClass: "vegan" })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const butter = db
    .insert(ingredient)
    .values({ name: "Butter", dietaryClass: "vegetarian" })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const mystery = db
    .insert(ingredient)
    .values({ name: "Würzmischung", dietaryClass: null })
    .returning({ id: ingredient.id })
    .all()[0].id;

  function addRecipe(title: string, ingIds: number[]): number {
    const rid = db
      .insert(recipe)
      .values({ title, servings: 2 })
      .returning({ id: recipe.id })
      .all()[0].id;
    const sid = db
      .insert(recipeSection)
      .values({ recipeId: rid, instructions: "" })
      .returning({ id: recipeSection.id })
      .all()[0].id;
    ingIds.forEach((iid, idx) =>
      db
        .insert(recipeIngredient)
        .values({ sectionId: sid, ingredientId: iid, sortOrder: idx })
        .run(),
    );
    return rid;
  }

  const tomatensuppe = addRecipe("Tomatensuppe", [tomate, basilikum]);
  const spaghettiBolognese = addRecipe("Spaghetti Bolognese", [tomate, hack]);
  const apfelkuchen = addRecipe("Apfelkuchen", [apfel, butter]);
  const unknownRecipe = addRecipe("Mystery-Eintopf", [mystery]);

  const veggieTag = db
    .insert(tag)
    .values({ name: "Schnell" })
    .returning({ id: tag.id })
    .all()[0].id;
  db.insert(recipeTag).values({ recipeId: tomatensuppe, tagId: veggieTag }).run();

  return { tomatensuppe, spaghettiBolognese, apfelkuchen, unknownRecipe };
}

describe("listRecipes", () => {
  let ids: Ids;
  beforeAll(async () => {
    ids = await seed();
  });

  it("empty options returns every recipe, title-sorted", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    const out = listRecipes();
    expect(out.map((r) => r.title)).toEqual([
      "Apfelkuchen",
      "Mystery-Eintopf",
      "Spaghetti Bolognese",
      "Tomatensuppe",
    ]);
  });

  it("title token matches title fuzzily", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    expect(listRecipes({ query: "tomate" }).map((r) => r.id)).toContain(
      ids.tomatensuppe,
    );
  });

  it("zutat: matches canonical ingredient", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    expect(listRecipes({ query: "zutat:basilikum" }).map((r) => r.id)).toEqual([
      ids.tomatensuppe,
    ]);
  });

  it("zutat: matches an ingredient alias", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    expect(
      listRecipes({ query: "zutat:strauchtomate" }).map((r) => r.id).sort(),
    ).toEqual([ids.spaghettiBolognese, ids.tomatensuppe].sort());
  });

  it("- excludes a token from the result", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    const out = listRecipes({ query: "zutat:tomate -zutat:hackfleisch" }).map(
      (r) => r.id,
    );
    expect(out).toEqual([ids.tomatensuppe]);
  });

  it("diet=vegetarian keeps vegan + vegetarian, drops meat and unknown", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    const out = listRecipes({ diet: "vegetarian" }).map((r) => r.id).sort();
    expect(out).toEqual([ids.apfelkuchen, ids.tomatensuppe].sort());
  });

  it("diet=vegan keeps only vegan tier", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    expect(listRecipes({ diet: "vegan" }).map((r) => r.id)).toEqual([
      ids.tomatensuppe,
    ]);
  });

  it("must-tags filter applies server-side", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    expect(listRecipes({ mustTags: ["Schnell"] }).map((r) => r.id)).toEqual([
      ids.tomatensuppe,
    ]);
  });

  it("combined query + diet + must-tags", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    const out = listRecipes({
      query: "tomate",
      diet: "vegan",
      mustTags: ["Schnell"],
    });
    expect(out.map((r) => r.id)).toEqual([ids.tomatensuppe]);
  });

  it("returns dietConfidence on every item", async () => {
    const { listRecipes } = await import("@/lib/recipes/service");
    const byId = new Map(listRecipes().map((r) => [r.id, r]));
    expect(byId.get(ids.tomatensuppe)?.dietConfidence).toBe("definite");
    expect(byId.get(ids.unknownRecipe)?.dietConfidence).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run the test and verify failures**

Run: `npm test -- tests/recipes-service.test.ts`
Expected: Several fail (alias matching, diet filter, must-tags server-side, `-zutat:` exclusion). The plain title-sorted listing should already pass.

- [ ] **Step 3: Add ingredient-index loader + rewrite the pipeline**

In `src/lib/recipes/service.ts`, first add this helper above `listRecipes`:

```typescript
/**
 * One folded `" "`-joined string per recipe containing canonical names + all
 * aliases for every non-optional ingredient. Used only when the parsed query
 * contains at least one `zutat:` token — otherwise we skip the join.
 */
function loadIngredientIndex(recipeIds: number[]): Map<number, string> {
  if (recipeIds.length === 0) return new Map();
  const rows = db
    .select({
      recipeId: recipeSection.recipeId,
      canonical: ingredientTable.name,
      alias: ingredientAliasTable.name,
    })
    .from(recipeIngredient)
    .innerJoin(recipeSection, eq(recipeSection.id, recipeIngredient.sectionId))
    .innerJoin(
      ingredientTable,
      eq(ingredientTable.id, recipeIngredient.ingredientId),
    )
    .leftJoin(
      ingredientAliasTable,
      eq(ingredientAliasTable.ingredientId, ingredientTable.id),
    )
    .where(
      and(
        inArray(recipeSection.recipeId, recipeIds),
        eq(recipeIngredient.isOptional, false),
      ),
    )
    .all();
  const acc = new Map<number, Set<string>>();
  for (const row of rows) {
    const set = acc.get(row.recipeId) ?? new Set<string>();
    set.add(fold(row.canonical));
    if (row.alias) set.add(fold(row.alias));
    acc.set(row.recipeId, set);
  }
  const out = new Map<number, string>();
  for (const [rid, set] of acc) out.set(rid, Array.from(set).join(" "));
  return out;
}
```

Now find the existing imports near the top of `service.ts` and add `fold`, `parseQuery`, `matchRecipe`:

```typescript
import { fold, matchRecipe, parseQuery } from "./search.ts";
```

Replace the entire body of `listRecipes` (everything inside the function, keep the signature) with:

```typescript
export function listRecipes(opts: ListRecipesOptions = {}): RecipeListItem[] {
  const { query, mustTags = [], notTags = [], diet } = opts;

  const rows = db.select().from(recipe).all();
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const dietByRecipe = computeDietForRecipes(ids);
  const tagsByRecipe = new Map<number, string[]>();
  const tagRows = db
    .select({ recipeId: recipeTag.recipeId, name: tag.name })
    .from(recipeTag)
    .innerJoin(tag, eq(tag.id, recipeTag.tagId))
    .where(inArray(recipeTag.recipeId, ids))
    .all();
  for (const tr of tagRows) {
    const list = tagsByRecipe.get(tr.recipeId) ?? [];
    list.push(tr.name);
    tagsByRecipe.set(tr.recipeId, list);
  }

  const parsed = parseQuery(query ?? "");
  const needsIngredientIndex = parsed.tokens.some((t) => t.kind === "zutat");
  const ingredientIndex = needsIngredientIndex
    ? loadIngredientIndex(ids)
    : new Map<number, string>();

  const mustLower = mustTags.map((t) => t.toLowerCase());
  const notLower = notTags.map((t) => t.toLowerCase());

  type Scored = { row: (typeof rows)[number]; rank: number };
  const scored: Scored[] = [];

  for (const r of rows) {
    const recipeTags = (tagsByRecipe.get(r.id) ?? []).sort();
    if (mustLower.length > 0 || notLower.length > 0) {
      const have = new Set(recipeTags.map((t) => t.toLowerCase()));
      let pass = true;
      for (const m of mustLower) {
        if (!have.has(m)) {
          pass = false;
          break;
        }
      }
      if (!pass) continue;
      for (const n of notLower) {
        if (have.has(n)) {
          pass = false;
          break;
        }
      }
      if (!pass) continue;
    }
    const dietRow =
      dietByRecipe.get(r.id) ?? {
        isVegan: true,
        isVegetarian: true,
        confidence: "definite" as const,
      };
    if (diet === "vegetarian" && dietRow.isVegetarian !== true) continue;
    if (diet === "vegan" && dietRow.isVegan !== true) continue;

    const match = matchRecipe(parsed, {
      titleFolded: fold(r.title),
      ingredientsFolded: ingredientIndex.get(r.id) ?? "",
    });
    if (!match.passes) continue;
    scored.push({ row: r, rank: match.rank });
  }

  const queryActive = parsed.tokens.length > 0;
  scored.sort((a, b) => {
    if (queryActive && a.rank !== b.rank) return b.rank - a.rank;
    return a.row.title.localeCompare(b.row.title, "de");
  });

  return scored.map(({ row: r }) => {
    const recipeTags = (tagsByRecipe.get(r.id) ?? []).sort();
    const dietRow =
      dietByRecipe.get(r.id) ?? {
        isVegan: true,
        isVegetarian: true,
        confidence: "definite" as const,
      };
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      photoPath: r.photoPath,
      servings: r.servings,
      prepTimeMin: r.prepTimeMin,
      cookTimeMin: r.cookTimeMin,
      tags: recipeTags,
      isVegan: dietRow.isVegan,
      isVegetarian: dietRow.isVegetarian,
      dietConfidence: dietRow.confidence,
    };
  });
}
```

Also remove the now-unused `like` / `or` imports if the linter flags them. Run `npm run lint` after to check.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass. The new `recipes-service.test.ts` is green; pre-existing tests still green.

- [ ] **Step 5: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/recipes/service.ts tests/recipes-service.test.ts
git commit -m "Recipe service: parser-driven listRecipes with diet + zutat: filters"
```

---

## Task 7: `DietBadge` confidence-aware rendering

**Files:**
- Modify: `src/components/recipes/diet-badge.tsx`

- [ ] **Step 1: Replace the component**

Replace the entire contents of `src/components/recipes/diet-badge.tsx` with:

```typescript
import { Leaf, Salad } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DietConfidence } from "@/lib/recipes/diet";

type Props = {
  isVegan: boolean | null;
  isVegetarian: boolean | null;
  confidence: DietConfidence;
  size?: "sm" | "md";
  className?: string;
};

/**
 * Single badge: the strongest claim available. "probable" tier uses a dashed
 * outline + "Wahrscheinlich " prefix; "definite" uses the filled pill from
 * before. Nothing rendered when the recipe has no claim to make.
 */
export function DietBadge({
  isVegan,
  isVegetarian,
  confidence,
  size = "md",
  className,
}: Props) {
  if (isVegan === true) {
    return (
      <Badge
        kind="vegan"
        confidence={confidence}
        size={size}
        className={className}
        Icon={Leaf}
        baseLabel="Vegan"
      />
    );
  }
  if (isVegetarian === true) {
    return (
      <Badge
        kind="vegetarian"
        confidence={confidence}
        size={size}
        className={className}
        Icon={Salad}
        baseLabel="Vegetarisch"
      />
    );
  }
  return null;
}

function Badge({
  kind,
  confidence,
  size,
  className,
  Icon,
  baseLabel,
}: {
  kind: "vegan" | "vegetarian";
  confidence: DietConfidence;
  size: "sm" | "md";
  className?: string;
  Icon: typeof Leaf;
  baseLabel: string;
}) {
  const accent = kind === "vegan" ? "var(--color-success)" : "var(--color-warning)";
  const padding = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  const iconSize = size === "sm" ? "size-3" : "size-3.5";
  const isProbable = confidence === "probable";
  const label = isProbable ? `Wahrscheinlich ${baseLabel}` : baseLabel;
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full font-medium",
        padding,
        isProbable && "border border-dashed",
        className,
      )}
      style={{
        background: isProbable
          ? "transparent"
          : `color-mix(in srgb, ${accent}, var(--color-bg) 82%)`,
        color: accent,
        ...(isProbable ? { borderColor: accent } : {}),
      }}
    >
      <Icon className={iconSize} />
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Update the `RecipeCard` call site**

In `src/components/recipes/recipe-card.tsx`, find:

```typescript
          <DietBadge
            isVegan={recipe.isVegan}
            isVegetarian={recipe.isVegetarian}
            size="sm"
          />
```

Replace with:

```typescript
          <DietBadge
            isVegan={recipe.isVegan}
            isVegetarian={recipe.isVegetarian}
            confidence={recipe.dietConfidence}
            size="sm"
          />
```

- [ ] **Step 3: Update the recipe detail page call site**

In `src/app/rezepte/[id]/page.tsx`, find:

```typescript
            <DietBadge
              isVegan={recipe.isVegan}
              isVegetarian={recipe.isVegetarian}
            />
```

Replace with:

```typescript
            <DietBadge
              isVegan={recipe.isVegan}
              isVegetarian={recipe.isVegetarian}
              confidence={recipe.dietConfidence}
            />
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/recipes/diet-badge.tsx src/components/recipes/recipe-card.tsx src/app/rezepte/\[id\]/page.tsx
git commit -m "Diet badge: render \"Wahrscheinlich …\" tier with dashed outline"
```

---

## Task 8: `DietFilter` component

**Files:**
- Create: `src/components/recipes/diet-filter.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/recipes/diet-filter.tsx`:

```typescript
"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Leaf, Salad } from "lucide-react";
import { cn } from "@/lib/cn";

type Choice = "all" | "vegetarian" | "vegan";

const PARAM_BY_CHOICE: Record<Choice, string | null> = {
  all: null,
  vegetarian: "vegetarian",
  vegan: "vegan",
};

function readChoice(raw: string | null): Choice {
  if (raw === "vegan") return "vegan";
  if (raw === "vegetarian") return "vegetarian";
  return "all";
}

export function DietFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = readChoice(params.get("diet"));

  function set(next: Choice) {
    const url = new URLSearchParams(params.toString());
    const value = PARAM_BY_CHOICE[next];
    if (value) url.set("diet", value);
    else url.delete("diet");
    const qs = url.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div
      role="radiogroup"
      aria-label="Diät-Filter"
      className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] p-0.5"
    >
      <Segment label="Alle" active={current === "all"} onClick={() => set("all")} />
      <Segment
        label="Vegetarisch"
        icon={<Salad className="size-3.5" />}
        accent="var(--color-warning)"
        active={current === "vegetarian"}
        onClick={() => set("vegetarian")}
      />
      <Segment
        label="Vegan"
        icon={<Leaf className="size-3.5" />}
        accent="var(--color-success)"
        active={current === "vegan"}
        onClick={() => set("vegan")}
      />
    </div>
  );
}

function Segment({
  label,
  icon,
  accent,
  active,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  accent?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "text-white"
          : "text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]",
      )}
      style={
        active && accent
          ? { background: accent }
          : active
            ? { background: "var(--color-fg)", color: "var(--color-bg)" }
            : undefined
      }
    >
      {icon}
      {label}
    </button>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/recipes/diet-filter.tsx
git commit -m "DietFilter: 3-segment toggle for Alle/Vegetarisch/Vegan"
```

---

## Task 9: `RecipeSearch` placeholder + syntax help

**Files:**
- Modify: `src/components/recipes/recipe-search.tsx`

- [ ] **Step 1: Update the component**

Replace the contents of `src/components/recipes/recipe-search.tsx` with:

```typescript
"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { HelpCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type Props = {
  /** Controlled value. When both `value` and `onChange` are passed, the
   *  component skips URL writes and reports debounced changes via the
   *  callback instead — useful for hosts that don't want filter retention. */
  value?: string;
  onChange?: (next: string) => void;
};

export function RecipeSearch({
  value: controlledValue,
  onChange: controlledOnChange,
}: Props = {}) {
  const isControlled = controlledValue != null && controlledOnChange != null;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = isControlled ? controlledValue : (params.get("q") ?? "");
  const [value, setValue] = React.useState(initial);

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      const q = value.trim();
      if (isControlled) {
        controlledOnChange(q);
        return;
      }
      const url = new URLSearchParams(params.toString());
      if (q) url.set("q", q);
      else url.delete("q");
      const qs = url.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 200);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-fg)]" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder='Suche: tomate "rote linsen" zutat:basilikum -nudeln'
        className="pl-9 pr-10"
        aria-label="Rezepte durchsuchen"
      />
      <Popover.Root>
        <Popover.Trigger
          className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]"
          aria-label="Suchsyntax-Hilfe"
        >
          <HelpCircle className="size-4" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            sideOffset={6}
            align="end"
            className="z-50 max-w-sm rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-sm shadow-lg"
          >
            <p className="font-medium text-[var(--color-fg)]">Suche</p>
            <ul className="mt-2 space-y-1.5 text-[var(--color-muted-fg)]">
              <li>
                <code className="text-[var(--color-fg)]">tomate basilikum</code> —
                alle Begriffe müssen im Titel vorkommen.
              </li>
              <li>
                <code className="text-[var(--color-fg)]">&quot;rote linsen&quot;</code> —
                Anführungszeichen für zusammenhängende Phrasen.
              </li>
              <li>
                <code className="text-[var(--color-fg)]">-nudeln</code> — Bindestrich
                schließt Treffer aus.
              </li>
              <li>
                <code className="text-[var(--color-fg)]">zutat:basilikum</code> —
                sucht in Zutaten (inkl. Aliase) statt im Titel.
              </li>
              <li>Tippfehler werden bis zu einer kleinen Distanz toleriert.</li>
            </ul>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/recipes/recipe-search.tsx
git commit -m "Recipe search: syntax-aware placeholder + help popover"
```

---

## Task 10: `RecipeGrid` becomes a pure renderer

**Files:**
- Modify: `src/components/recipes/recipe-grid.tsx`

- [ ] **Step 1: Replace the component**

Replace the entire contents of `src/components/recipes/recipe-grid.tsx` with:

```typescript
import { RecipeCard } from "./recipe-card";
import type { RecipeListItem } from "@/lib/recipes/types";

type Props = {
  recipes: RecipeListItem[];
  totalUnfiltered: number;
  filtersActive: boolean;
};

export function RecipeGrid({ recipes, totalUnfiltered, filtersActive }: Props) {
  const shown = recipes.length;
  const someFilteredOut = shown < totalUnfiltered;
  return (
    <>
      <p className="mt-2 text-sm text-[var(--color-muted-fg)]">
        {shown === 0
          ? filtersActive
            ? "Keine Treffer mit den aktuellen Filtern."
            : "Noch keine Rezepte – jetzt das erste anlegen."
          : someFilteredOut
            ? `${shown} von ${totalUnfiltered} Rezepten.`
            : `${shown} Rezept${shown === 1 ? "" : "e"}.`}
      </p>
      <div className="mt-6 grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {recipes.map((r) => (
          <RecipeCard key={r.id} recipe={r} />
        ))}
      </div>
    </>
  );
}
```

Note: this is now a server component (no `"use client"`). It no longer reads URL params.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: One error in `src/app/rezepte/page.tsx` because `<RecipeGrid />` is called with the old props. That's fixed in Task 11.

- [ ] **Step 3: Commit**

```bash
git add src/components/recipes/recipe-grid.tsx
git commit -m "RecipeGrid: pure renderer, server-side filtering done upstream"
```

---

## Task 11: Wire `RezeptePage` to forward all params + render `DietFilter`

**Files:**
- Modify: `src/app/rezepte/page.tsx`

- [ ] **Step 1: Update the page**

Replace the contents of `src/app/rezepte/page.tsx` with:

```typescript
import Link from "next/link";
import { asc } from "drizzle-orm";
import { Download, Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { DietFilter } from "@/components/recipes/diet-filter";
import { RecipeGrid } from "@/components/recipes/recipe-grid";
import { RecipeSearch } from "@/components/recipes/recipe-search";
import { TagFilterBar } from "@/components/recipes/tag-filter-bar";
import { listRecipes } from "@/lib/recipes/service";
import { db } from "@/db";
import { tag } from "@/db/schema";

export const dynamic = "force-dynamic";

type Search = {
  q?: string;
  must?: string;
  not?: string;
  diet?: string;
};

function parseTagList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseDiet(raw: string | undefined): "vegetarian" | "vegan" | undefined {
  if (raw === "vegan") return "vegan";
  if (raw === "vegetarian") return "vegetarian";
  return undefined;
}

export default async function RezeptePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { q, must, not, diet } = await searchParams;
  const mustTags = parseTagList(must);
  const notTags = parseTagList(not);
  const dietFilter = parseDiet(diet);

  const filteredRecipes = listRecipes({
    query: q,
    mustTags,
    notTags,
    diet: dietFilter,
  });
  const totalUnfiltered = listRecipes().length;
  const filtersActive = Boolean(
    q?.trim().length || mustTags.length || notTags.length || dietFilter,
  );

  const allTags = db
    .select({ name: tag.name })
    .from(tag)
    .orderBy(asc(tag.name))
    .all()
    .map((t) => t.name);

  return (
    <AppShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rezepte</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/rezepte/importieren">
              <Download className="size-4" />
              Importieren
            </Link>
          </Button>
          <Button asChild>
            <Link href="/rezepte/neu">
              <Plus className="size-4" />
              Neues Rezept
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <RecipeSearch />
      </div>

      <div className="mt-4">
        <DietFilter />
      </div>

      {allTags.length > 0 ? (
        <div className="mt-4">
          <TagFilterBar allTags={allTags} />
        </div>
      ) : null}

      <RecipeGrid
        recipes={filteredRecipes}
        totalUnfiltered={totalUnfiltered}
        filtersActive={filtersActive}
      />
    </AppShell>
  );
}
```

- [ ] **Step 2: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/rezepte/page.tsx
git commit -m "Rezepte page: forward q/must/not/diet to listRecipes, render DietFilter"
```

---

## Task 12: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run lint + typecheck**

Run: `npm run typecheck && npm run lint`
Expected: No errors.

- [ ] **Step 3: Manual smoke in browser**

Start the dev server (`npm run dev`) and walk through these scenarios at `http://localhost:3000/rezepte`:

1. Empty page — recipes listed alphabetically, counter shows `N Rezepte.`.
2. Type `tomate` — list narrows; results ranked.
3. Type `"rote linsen"` (with quotes) — only exact-phrase matches.
4. Type `zutat:basilikum` — only recipes that actually contain basil.
5. Type `pasta -tomate` — `-` exclusion works.
6. Toggle the Vegan segment — only vegan-tier recipes remain (definite + probable).
7. Toggle Vegetarian then a tag — all three filters compose.
8. Open a recipe whose `dietary_class` data is partly tagged but no meat → badge reads "Wahrscheinlich Vegetarisch" / "Wahrscheinlich Vegan" with a dashed outline.
9. Open the search help popover via the `(?)` icon — content renders correctly.

If any of those fail, fix on the appropriate task's files. Do not claim the feature done without walking through all 9.

- [ ] **Step 4: Final commit (if any tweaks)**

```bash
git status
# If anything is pending, commit with a tweak message; otherwise this step is a no-op.
```

---

## Self-Review

**Spec coverage:**
- §1 Query parser → Task 2 + Task 3.
- §2 Diet derivation (confidence tiers) → Task 1.
- §3 Service layer (`diet` option, ingredient index, pipeline) → Task 5 + Task 6.
- §4 UI (search placeholder + help, `DietFilter`, `RecipeGrid` pure render, `RezeptePage` wiring, `DietBadge` confidence) → Tasks 7–11.
- §5 Wiring (`getRecipe` + recipe detail page) → Task 5 + Task 7.
- §6 Tests (parser, scoring, diet, service) → Tasks 1, 2, 3, 6.
- §7 File touch list → all covered above.

**Placeholder scan:** None found — every step contains the actual code or command.

**Type consistency:**
- `DietConfidence` exported from `diet.ts` (Task 1) and imported in `types.ts` (Task 4), `diet-badge.tsx` (Task 7).
- `RecipeListItem.dietConfidence` introduced in Task 4 and populated in Task 5 (`listRecipes` projection) and consumed in Task 7 (`<RecipeCard>` + `<DietBadge>`) and Task 11 (page).
- `ParsedQuery`, `ParsedToken`, `MatchResult`, `RecipeSearchIndex` only referenced inside `search.ts` and its tests + `service.ts`. Names match across all three.
- `parseQuery`, `fold`, `matchRecipe` exports in `search.ts` are imported with those exact names in Task 6.
