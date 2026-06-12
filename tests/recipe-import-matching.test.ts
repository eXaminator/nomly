/**
 * End-to-end checks for `parseIngredientLines` with the new substring
 * matcher + min-score gate. Uses hand-built lookups (no DB) so the tests
 * stay deterministic and the catalog shape matches what `findIngredient
 * Candidates` would see in production.
 */

import { describe, expect, it } from "vitest";
import {
  parseIngredientLines,
  parseIngredientLinesIntoSections,
  parseIngredientGroupsIntoSections,
  type IngredientLookup,
  type ParseLookups,
  type UnitLookup,
} from "@/lib/recipe-import";
import type { IngredientCatalog } from "@/lib/recipe-import/matching";

function makeLookups(
  catalog: IngredientCatalog,
  extraUnits: readonly string[] = [],
): ParseLookups {
  const unitEntries = ["g", ...extraUnits].map((name, i) => [
    name.toLowerCase(),
    { id: i + 1, name, isContainer: false },
  ] as const);
  const units: UnitLookup = {
    byNameOrAlias: new Map(unitEntries),
    byCanonicalName: new Map(unitEntries),
    byId: new Map(unitEntries.map(([, e]) => [e.id, e] as const)),
    containerTokens: new Set(),
    globalDefaultUnitId: null,
  };
  const ingredients: IngredientLookup = new Map();
  for (const entry of catalog) {
    ingredients.set(entry.aliasName.toLowerCase(), {
      id: entry.ingredientId,
      canonicalName: entry.canonicalName,
    });
  }
  return { units, ingredients, ingredientCatalog: catalog };
}

describe("parseIngredientLines — substring matcher + threshold", () => {
  it("auto-picks the longest-alias match for a clean known ingredient", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 2,
        canonicalName: "Paprikapulver",
        aliasName: "Paprikapulver",
        tokens: ["paprikapulver"],
      },
      {
        ingredientId: 2,
        canonicalName: "Paprikapulver",
        aliasName: "Paprikapulver rosenscharf",
        tokens: ["paprikapulver", "rosenscharf"],
      },
    ];
    const out = parseIngredientLines(
      ["1 g Paprikapulver, rosenscharfes"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(2);
    // The display name is the matched alias verbatim. The 2-token alias covers
    // both "Paprikapulver" and "rosenscharfes" (post-comma, close-inflection),
    // so nothing is left over for notes.
    expect(out[0].name).toBe("Paprikapulver rosenscharf");
    expect(out[0].ingredientMatch).toBe("existing");
    // Whole candidate covered by the match → no leftover in notes.
    expect(out[0].notes).toBeNull();
  });

  it("does NOT collapse 'Paprikapulver Rosenscharf' into a catalog-only 'Paprika'", () => {
    // Familywall-style risk: a previous import created "Paprika" but the
    // current recipe is referring to a different product. Without the
    // threshold the prefix-match would mis-resolve.
    const catalog: IngredientCatalog = [
      {
        ingredientId: 1,
        canonicalName: "Paprika",
        aliasName: "Paprika",
        tokens: ["paprika"],
      },
    ];
    const out = parseIngredientLines(
      ["10 g Paprikapulver Rosenscharf"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBeNull();
    expect(out[0].ingredientMatch).toBe("new");
    // Surface the weak Paprika hit as a candidate match so the import-
    // review UI can offer it as a pill, but auto-resolution must NOT use it.
    expect(out[0].candidateMatches.some((c) => c.canonicalName === "Paprika")).toBe(true);
  });

  it("re-matches the cleaned name after prep-strip ('frischer Zucker' → Zucker)", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 9,
        canonicalName: "Zucker",
        aliasName: "Zucker",
        tokens: ["zucker"],
      },
    ];
    const out = parseIngredientLines(
      ["100 g frischer Zucker"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(9);
    expect(out[0].name).toBe("Zucker");
    expect(out[0].ingredientMatch).toBe("existing");
  });

  it("merges a German plural inflection into its singular (Paprikaschoten → Paprikaschote)", () => {
    // The display name is the matched alias (here the canonical "Paprikaschote"
    // itself), so the plural input collapses to the catalog spelling and
    // `ingredientId` points at the singular for shopping-list merging. Name ==
    // canonical, so no separate `canonicalIngredientName` disclosure is needed.
    const catalog: IngredientCatalog = [
      {
        ingredientId: 5,
        canonicalName: "Paprikaschote",
        aliasName: "Paprikaschote",
        tokens: ["paprikaschote"],
      },
    ];
    const out = parseIngredientLines(
      ["100 g Paprikaschoten"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(5);
    expect(out[0].name).toBe("Paprikaschote");
    expect(out[0].canonicalIngredientName).toBeNull();
    expect(out[0].ingredientMatch).toBe("existing");
  });

  it("auto-merges 'Paprikaschote(n), rote (fein gehackt)' to catalog Paprikaschoten via a color-variant alias", () => {
    // Color disambiguation is handled in the seeded catalog, not via word
    // lists in the matcher. Adding "rote Paprikaschote" as an alias of
    // canonical Paprikaschoten gives the matcher a 2-token entry that
    // covers BOTH the pre-comma identity ("Paprikaschote") and the
    // comma-tail descriptor ("rote") — full coverage + close-inflection,
    // scores well above the auto-merge gate. Parens still route "(fein
    // gehackt)" to notes.
    const catalog: IngredientCatalog = [
      {
        ingredientId: 6,
        canonicalName: "Paprikaschoten",
        aliasName: "Paprikaschoten",
        tokens: ["paprikaschoten"],
      },
      {
        ingredientId: 6,
        canonicalName: "Paprikaschoten",
        aliasName: "rote Paprikaschote",
        tokens: ["rote", "paprikaschote"],
      },
    ];
    const out = parseIngredientLines(
      ["100 g Paprikaschote(n), rote (fein gehackt)"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(6);
    expect(out[0].ingredientMatch).toBe("existing");
    // Parenthesised prep phrase still lands in notes.
    expect(out[0].notes).toMatch(/fein gehackt/);
  });

  it("propagates isEquipment on candidate matches so the pill UI can auto-mark equipment rows optional", () => {
    // The matcher carries the catalog entry's equipment flag through to
    // each candidate match. The pill click handler and the live-matcher
    // auto-select rule key off this to default the row to isOptional=true
    // when a row resolves to equipment — same outcome as the import-time
    // path, just applied at edit time.
    const catalog: IngredientCatalog = [
      {
        ingredientId: 42,
        canonicalName: "Backpapier",
        aliasName: "Backpapier",
        tokens: ["backpapier"],
        isEquipment: true,
      },
      {
        ingredientId: 7,
        canonicalName: "Mehl",
        aliasName: "Mehl",
        tokens: ["mehl"],
      },
    ];
    const out = parseIngredientLines(
      ["1 Backpapier", "200 g Mehl"],
      makeLookups(catalog),
    );
    const backpapierMatch = out[0].candidateMatches.find(
      (c) => c.ingredientId === 42,
    );
    const mehlMatch = out[1].candidateMatches.find((c) => c.ingredientId === 7);
    expect(backpapierMatch?.isEquipment).toBe(true);
    expect(mehlMatch?.isEquipment).toBe(false);
  });

  it("collapses multiple aliases of the same ingredient into a single pill, preferring the canonical row", () => {
    // When a catalog has the canonical row PLUS one or more aliases that
    // all match a candidate equally well, the dedup must keep exactly one
    // match per ingredient, and it should be the canonical row so the pill
    // label leads with the canonical name. Without the canonical-row
    // tiebreak the longer alias would win arbitrarily.
    const catalog: IngredientCatalog = [
      // Two aliases of the same ingredient that BOTH exactly match the
      // candidate text "Paprika".
      {
        ingredientId: 1,
        canonicalName: "Paprika",
        aliasName: "Paprika",
        tokens: ["paprika"],
      },
      {
        ingredientId: 1,
        canonicalName: "Paprika",
        // Synthetic same-token alias to exercise the tiebreak path —
        // would tie on score with the canonical without the boost.
        aliasName: "Paprika frisch",
        tokens: ["paprika"],
      },
    ];
    const out = parseIngredientLines(
      ["1 g Paprika"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    // Dedup by ingredientId: only one match for ingredient 1.
    const paprikaMatches = out[0].candidateMatches.filter(
      (c) => c.ingredientId === 1,
    );
    expect(paprikaMatches).toHaveLength(1);
    // Canonical row wins the within-ingredient tiebreak.
    expect(paprikaMatches[0].matchedName).toBe("Paprika");
  });

  it("each candidate match carries its own finished name/notes (uncovered tokens → notes)", () => {
    // A wide-text match that didn't auto-pick still surfaces as a pill,
    // carrying the name/notes it WOULD apply if picked — the matched alias as
    // the name, every uncovered token as notes. No client-side subtraction.
    const catalog: IngredientCatalog = [
      {
        ingredientId: 5,
        canonicalName: "Knoblauch",
        aliasName: "Knoblauch",
        tokens: ["knoblauch"],
      },
    ];
    const out = parseIngredientLines(
      ["1 Knoblauchzehe rote"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    const knoblauchCandidate = out[0].candidateMatches.find(
      (c) => c.ingredientId === 5,
    );
    expect(knoblauchCandidate).toBeDefined();
    // "knoblauch" prefix-matches "knoblauchzehe" (the covered token), so the
    // pill's name is the alias "Knoblauch" and "rote" lands in notes.
    expect(knoblauchCandidate?.name).toBe("Knoblauch");
    expect(knoblauchCandidate?.notes).toBe("rote");
  });

  it("merges a German plural inflection in the reverse direction (Paprikaschote → catalog Paprikaschoten)", () => {
    // The catalog happens to hold the plural form (whichever recipe got
    // imported first); a later recipe with the singular still merges, and the
    // matched alias (the catalog's plural spelling) becomes the display name.
    const catalog: IngredientCatalog = [
      {
        ingredientId: 6,
        canonicalName: "Paprikaschoten",
        aliasName: "Paprikaschoten",
        tokens: ["paprikaschoten"],
      },
    ];
    const out = parseIngredientLines(
      ["100 g Paprikaschote"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(6);
    expect(out[0].name).toBe("Paprikaschoten");
    expect(out[0].canonicalIngredientName).toBeNull();
    expect(out[0].ingredientMatch).toBe("existing");
  });

  it("auto-resolves 'Paprika-Pulver' to catalog 'Paprikapulver' over catalog 'Paprika'", () => {
    // The dash tokenises into ["paprika", "pulver"] under the primary
    // tokenisation — Paprika would win on a 1-token exact hit. The joined
    // variant gives Paprikapulver an equal 135 plus the alias-length
    // tiebreak, so the parser picks Paprikapulver. The display name is the
    // matched alias "Paprikapulver" (== canonical, so no separate disclosure).
    const catalog: IngredientCatalog = [
      {
        ingredientId: 1,
        canonicalName: "Paprika",
        aliasName: "Paprika",
        tokens: ["paprika"],
      },
      {
        ingredientId: 2,
        canonicalName: "Paprikapulver",
        aliasName: "Paprikapulver",
        tokens: ["paprikapulver"],
      },
    ];
    const out = parseIngredientLines(
      ["10 g Paprika-Pulver"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(2);
    expect(out[0].name).toBe("Paprikapulver");
    expect(out[0].canonicalIngredientName).toBeNull();
    expect(out[0].ingredientMatch).toBe("existing");
  });

  it("respects a catalog that grew between invocations (mirrors familywall loop refresh)", () => {
    // First call: empty catalog → row creates a new ingredient.
    const initial: IngredientCatalog = [];
    const firstOut = parseIngredientLines(
      ["100 g Paprikaschote"],
      makeLookups(initial),
    );
    expect(firstOut[0].ingredientMatch).toBe("new");
    expect(firstOut[0].name).toBe("Paprikaschote");

    // The orchestrator persists the new ingredient and rebuilds lookups.
    // We simulate that by handing parseIngredientLines a catalog that now
    // contains the row we'd just have created.
    const refreshed: IngredientCatalog = [
      {
        ingredientId: 42,
        canonicalName: "Paprikaschote",
        aliasName: "Paprikaschote",
        tokens: ["paprikaschote"],
      },
    ];
    const secondOut = parseIngredientLines(
      ["100 g Paprikaschoten"],
      makeLookups(refreshed),
    );
    expect(secondOut[0].ingredientMatch).toBe("existing");
    expect(secondOut[0].ingredientId).toBe(42);
    // The matched alias is the display name: the plural input collapses to the
    // catalog's "Paprikaschote" (== canonical, so no separate disclosure).
    expect(secondOut[0].name).toBe("Paprikaschote");
    expect(secondOut[0].canonicalIngredientName).toBeNull();
  });

  it("matches 'Paprikapulver edelsüß' to bare 'Paprikapulver' (edelsüß → notes)", () => {
    // Structural model: with only the bare "Paprikapulver" seeded, the
    // descriptor "edelsüß" falls outside the matched span and becomes a
    // note. To keep "Paprikapulver edelsüß" a distinct product, seed it as
    // its own catalog entry (2 tokens win by coverage).
    const catalog: IngredientCatalog = [
      {
        ingredientId: 2,
        canonicalName: "Paprikapulver",
        aliasName: "Paprikapulver",
        tokens: ["paprikapulver"],
      },
    ];
    const out = parseIngredientLines(
      ["1 g Paprikapulver edelsüß"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(2);
    expect(out[0].ingredientMatch).toBe("existing");
    expect(out[0].name).toBe("Paprikapulver");
    expect(out[0].notes).toBe("edelsüß");
  });

  it("treats 'Paprikapulver, edelsüß' (with comma) the same way as the no-comma form", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 2,
        canonicalName: "Paprikapulver",
        aliasName: "Paprikapulver",
        tokens: ["paprikapulver"],
      },
    ];
    const out = parseIngredientLines(
      ["1 g Paprikapulver, edelsüß"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(2);
    expect(out[0].ingredientMatch).toBe("existing");
    expect(out[0].name).toBe("Paprikapulver");
    expect(out[0].notes).toBe("edelsüß");
  });

  it("'Erbsen, TK' matches bare 'Erbsen' with TK as a note (catalog decides identity)", () => {
    // Structural model: with only bare "Erbsen", the comma-tail "TK" is
    // outside the matched span → notes. Seed "TK Erbsen" as its own entry
    // to keep frozen peas distinct (next test).
    const catalog: IngredientCatalog = [
      {
        ingredientId: 5,
        canonicalName: "Erbsen",
        aliasName: "Erbsen",
        tokens: ["erbsen"],
      },
    ];
    const out = parseIngredientLines(["2 g Erbsen, TK"], makeLookups(catalog));
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(5);
    expect(out[0].ingredientMatch).toBe("existing");
    expect(out[0].name).toBe("Erbsen");
    expect(out[0].notes).toBe("TK");
  });

  it("'Erbsen, TK' wins the 2-token 'TK Erbsen' entry when the catalog has it", () => {
    // The catalog has the canonical "TK Erbsen". The matcher covers BOTH
    // "erbsen" (pre-comma) and "tk" (post-comma), and the display name is the
    // matched alias verbatim ("TK Erbsen") — not the source word order.
    const catalog: IngredientCatalog = [
      {
        ingredientId: 42,
        canonicalName: "TK Erbsen",
        aliasName: "TK Erbsen",
        tokens: ["tk", "erbsen"],
      },
    ];
    const out = parseIngredientLines(["2 g Erbsen, TK"], makeLookups(catalog));
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(42);
    expect(out[0].name).toBe("TK Erbsen");
    // Name == canonical → no separate disclosure needed.
    expect(out[0].canonicalIngredientName).toBeNull();
    // Whole candidate covered → no leftover note.
    expect(out[0].notes).toBeNull();
  });

  it("leaves unmatched tokens in notes ('Erbsen, TK, saftig' → name 'TK Erbsen' + notes 'saftig')", () => {
    // "TK" + "erbsen" are covered by the 2-token entry (name = the alias
    // "TK Erbsen"); "saftig" sits outside the match → notes.
    const catalog: IngredientCatalog = [
      {
        ingredientId: 42,
        canonicalName: "TK Erbsen",
        aliasName: "TK Erbsen",
        tokens: ["tk", "erbsen"],
      },
    ];
    const out = parseIngredientLines(
      ["2 g Erbsen, TK, saftig"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(42);
    expect(out[0].name).toBe("TK Erbsen");
    expect(out[0].notes).toMatch(/saftig/);
  });

  it("still merges 'Tomaten, klein gehackt' to Tomate (commaTail is all prep-like)", () => {
    // Counterpoint: when the comma-tail content is ALL prep-like
    // ("klein" is SIZE_MODIFIER, "gehackt" is PREP_LEADING_TOKEN), the row
    // links to the broader canonical. The display name is the matched alias
    // ("Tomate") and the qualifier lands in notes.
    const catalog: IngredientCatalog = [
      {
        ingredientId: 3,
        canonicalName: "Tomate",
        aliasName: "Tomate",
        tokens: ["tomate"],
      },
    ];
    const out = parseIngredientLines(
      ["3 g Tomaten, klein gehackt"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(3);
    expect(out[0].name).toBe("Tomate");
    expect(out[0].notes).toMatch(/klein gehackt/);
  });

  it("creates a new ingredient when nothing matches at all", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 3,
        canonicalName: "Tomate",
        aliasName: "Tomate",
        tokens: ["tomate"],
      },
    ];
    const out = parseIngredientLines(["3 g Quinoa"], makeLookups(catalog));
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBeNull();
    expect(out[0].ingredientMatch).toBe("new");
    expect(out[0].name).toBe("Quinoa");
    expect(out[0].newNameProposals.length).toBeGreaterThan(0);
  });

  it("matches 'Cherry-Tomate' to a bare 'Tomate' entry (Cherry → notes)", () => {
    // Structural flip: with only bare "Tomate", "Cherry-Tomate" resolves to
    // Tomate and "Cherry" lands in notes. Seed "Cherry-Tomate" to keep it
    // distinct (it wins by token coverage).
    const catalog: IngredientCatalog = [
      {
        ingredientId: 3,
        canonicalName: "Tomate",
        aliasName: "Tomate",
        tokens: ["tomate"],
      },
    ];
    const out = parseIngredientLines(["3 g Cherry-Tomate"], makeLookups(catalog));
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(3);
    expect(out[0].ingredientMatch).toBe("existing");
    expect(out[0].name).toBe("Tomate");
    expect(out[0].notes).toBe("Cherry");
  });

  it("keeps a unit-less trailing number in the name ('Weizenmehl Typ 405' matches its alias)", () => {
    // The secondary-amounts peel must not strip a bare number that has no
    // unit attached — "405" is product identity ("Weizenmehl Typ 405"), not a
    // parallel measurement. With the number kept, the 3-token alias covers the
    // whole candidate and beats the bare canonical.
    const catalog: IngredientCatalog = [
      {
        ingredientId: 7,
        canonicalName: "Weizenmehl",
        aliasName: "Weizenmehl",
        tokens: ["weizenmehl"],
      },
      {
        ingredientId: 7,
        canonicalName: "Weizenmehl",
        aliasName: "Weizenmehl Typ 405",
        tokens: ["weizenmehl", "typ", "405"],
      },
    ];
    const out = parseIngredientLines(
      ["200 g Weizenmehl Typ 405"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(7);
    expect(out[0].ingredientMatch).toBe("existing");
    expect(out[0].name).toBe("Weizenmehl Typ 405");
    expect(out[0].notes).toBeNull();
  });
});

describe("colon-in-name treated as section + listed items", () => {
  it("fans 'Topping: cheese' out into the post-colon item in parseIngredientLines (flat variant)", () => {
    // The pre-colon "Topping" is dropped (it's a section title, and the
    // flat variant has no concept of sections), but the post-colon
    // content is parsed as ingredient(s) rather than silently lost.
    const out = parseIngredientLines(
      ["1 g Mehl", "Topping: cheese", "2 g Zucker"],
      makeLookups([]),
    );
    expect(out).toHaveLength(3);
    expect(out.map((i) => i.name)).toEqual(["Mehl", "cheese", "Zucker"]);
  });

  it("promotes 'Topping: cheese' to section 'Topping' + ingredient 'cheese' in parseIngredientLinesIntoSections", () => {
    const out = parseIngredientLinesIntoSections(
      ["1 g Mehl", "Topping: cheese", "2 g Zucker"],
      makeLookups([]),
    );
    expect(out[0]).toMatchObject({
      title: null,
      ingredients: expect.arrayContaining([expect.objectContaining({ name: "Mehl" })]),
    });
    expect(out[1].title).toBe("Topping");
    // 'cheese' is the post-colon item; 'Zucker' is the next line, still
    // in the Topping section (no further header in between).
    expect(out[1].ingredients.map((i) => i.name)).toEqual(["cheese", "Zucker"]);
  });

  it("splits 'Garnish: Cilantro, crushed peanuts, red pepper flakes' into a section + 3 ingredients", () => {
    const original = "Garnish: Cilantro, crushed peanuts, red pepper flakes";
    const out = parseIngredientLinesIntoSections([original], makeLookups([]));
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Garnish");
    // "crushed" is a leading prep token → strips to notes (see
    // PREP_LEADING_TOKENS / feedback_prep_vs_identity_tokens.md). The
    // ingredient name is the noun, the prep word survives in notes.
    expect(out[0].ingredients.map((i) => i.name)).toEqual([
      "Cilantro",
      "peanuts",
      "red pepper flakes",
    ]);
    expect(out[0].ingredients[1].notes).toMatch(/crushed/i);
    // Each ingredient keeps the FULL original line in rawText so the
    // import-review UI can show where the row came from.
    for (const ing of out[0].ingredients) {
      expect(ing.rawText).toBe(original);
    }
  });

  it("flat-variant emits the list items but drops the section title for 'Garnish: A, B, C'", () => {
    const out = parseIngredientLines(
      ["Garnish: Cilantro, crushed peanuts, red pepper flakes"],
      makeLookups([]),
    );
    // Same prep-strip rule applies — "crushed" lands in notes.
    expect(out.map((i) => i.name)).toEqual([
      "Cilantro",
      "peanuts",
      "red pepper flakes",
    ]);
  });

  it("handles German purpose prefixes 'zum Garnieren:' / 'Dazu:' the same way as 'Garnish:'", () => {
    const out = parseIngredientLinesIntoSections(
      ["zum Garnieren: etwas Petersilie"],
      makeLookups([]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("zum Garnieren");
    expect(out[0].ingredients.map((i) => i.name)).toEqual(["Petersilie"]);
  });

  it("strips a pure 'Optional:' / 'optional:' prefix and marks the ingredient(s) optional, with NO section", () => {
    const out = parseIngredientLinesIntoSections(
      ["Optional: 2 g Sesamsaat", "optional: 1 g Chili"],
      makeLookups([]),
    );
    // Both lines fold into the leading null section — no "Optional" section
    // is created since "optional" is a status word, not a section title.
    expect(out).toHaveLength(1);
    expect(out[0].title).toBeNull();
    expect(out[0].ingredients).toHaveLength(2);
    expect(out[0].ingredients[0].name).toBe("Sesamsaat");
    expect(out[0].ingredients[0].isOptional).toBe(true);
    expect(out[0].ingredients[1].name).toBe("Chili");
    expect(out[0].ingredients[1].isOptional).toBe(true);
  });

  it("tolerates the 'opional:' typo as the Optional: prefix", () => {
    const out = parseIngredientLines(
      ["opional: 1 g Dip"],
      makeLookups([]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Dip");
    expect(out[0].isOptional).toBe(true);
  });

  it("'alternativ:' splits into the primary (status preserved) + alternative(s) forced optional + flagged isAlternative", () => {
    // Both ingredients in the catalog → the alternative stays as its own
    // row (the fold-back-to-notes path only kicks in for unmatched alts).
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Tahin", aliasName: "Tahin", tokens: ["tahin"] },
      { ingredientId: 2, canonicalName: "Mandelmus", aliasName: "Mandelmus", tokens: ["mandelmus"] },
    ];
    const out = parseIngredientLines(
      ["1 g Tahin alternativ: 1 g Mandelmus"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("Tahin");
    expect(out[0].isOptional).toBe(false);
    expect(out[0].isAlternative).toBe(false);
    expect(out[1].name).toBe("Mandelmus");
    expect(out[1].isOptional).toBe(true);
    expect(out[1].isAlternative).toBe(true);
  });

  it("'(Alternativ: X)' in parens after a primary ingredient adds X as an optional alternative", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Reis", aliasName: "Reis", tokens: ["reis"] },
      { ingredientId: 2, canonicalName: "Naan-Brot", aliasName: "Naan-Brot", tokens: ["naan", "brot"] },
    ];
    const out = parseIngredientLines(
      ["300 g Reis (Alternativ: Naan-Brot)"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("Reis");
    expect(out[0].isOptional).toBe(false);
    expect(out[0].isAlternative).toBe(false);
    // Name = the matched alias "Naan-Brot" verbatim (not a space-joined span).
    expect(out[1].name).toBe("Naan-Brot");
    expect(out[1].isOptional).toBe(true);
    expect(out[1].isAlternative).toBe(true);
  });

  it("'(Alternativ A oder B)' in parens yields one alternative row per option", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Ahornsirup", aliasName: "Ahornsirup", tokens: ["ahornsirup"] },
      { ingredientId: 2, canonicalName: "Honig", aliasName: "Honig", tokens: ["honig"] },
      { ingredientId: 3, canonicalName: "Zucker", aliasName: "Zucker", tokens: ["zucker"] },
    ];
    const out = parseIngredientLines(
      ["2 EL Ahornsirup (Alternativ Honig oder Zucker)"],
      makeLookups(catalog, ["EL"]),
    );
    expect(out).toHaveLength(3);
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].isAlternative).toBe(false);
    expect(out[1].ingredientId).toBe(2);
    expect(out[1].isAlternative).toBe(true);
    expect(out[2].ingredientId).toBe(3);
    expect(out[2].isAlternative).toBe(true);
  });

  it("matches a parenthetical alternative even when a note tail follows it", () => {
    // "(or chili flakes) more to taste" — the alternative isn't line-final,
    // but it must still split out and match; the tail becomes a note.
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Cayennepfeffer", aliasName: "cayenne", tokens: ["cayenne"] },
      { ingredientId: 2, canonicalName: "Chiliflocken", aliasName: "chili flakes", tokens: ["chili", "flakes"] },
    ];
    const out = parseIngredientLines(
      ["1/4-3/4 teaspoon cayenne (or chili flakes) more to taste"],
      makeLookups(catalog, ["teaspoon"]),
    );
    expect(out).toHaveLength(2);
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].isAlternative).toBe(false);
    expect(out[1].ingredientId).toBe(2);
    expect(out[1].isAlternative).toBe(true);
    // The trailing "more to taste" isn't lost.
    expect(out[0].notes).toMatch(/more to taste/i);
  });

  it("comma-separates a leading size modifier from a post-unit descriptor in notes", () => {
    // "1 small bunch fresh parsley": "small" describes the bunch (pre-unit
    // size note), "fresh" describes the parsley (post-unit). The unit between
    // them is consumed, so the two distinct notes must stay comma-separated —
    // "small, fresh", not glued into "small fresh".
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Petersilie", aliasName: "parsley", tokens: ["parsley"] },
    ];
    const out = parseIngredientLines(
      ["1 small bunch fresh parsley"],
      makeLookups(catalog, ["bunch"]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].unit?.name).toBe("bunch");
    expect(out[0].notes).toBe("small, fresh");
  });

  it("'(or substitute X)' parens yields X as an alternative; size compound → notes", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Weißkohl", aliasName: "shredded cabbage", tokens: ["shredded", "cabbage"] },
      { ingredientId: 2, canonicalName: "Krautsalat", aliasName: "coleslaw mix", tokens: ["coleslaw", "mix"] },
    ];
    const out = parseIngredientLines(
      ["6 cups shredded cabbage (or substitute a 10-ounce bag of coleslaw mix)"],
      makeLookups(catalog, ["cup", "cups", "ounce", "bag"]),
    );
    expect(out).toHaveLength(2);
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].isAlternative).toBe(false);
    // The alternative is a real row (matched), NOT folded into the primary's
    // notes. "10-ounce" rides along as a note; "bag" is the unit.
    expect(out[1].ingredientId).toBe(2);
    expect(out[1].isAlternative).toBe(true);
    expect(out[1].isOptional).toBe(true);
    expect(out[1].unit?.name).toBe("bag");
    expect(out[1].notes).toMatch(/10-ounce/i);
    expect(out[0].notes ?? "").not.toMatch(/coleslaw/i);
  });

  it("'alternativ: A oder B' separator yields one alternative row per option", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Tahin", aliasName: "Tahin", tokens: ["tahin"] },
      { ingredientId: 2, canonicalName: "Honig", aliasName: "Honig", tokens: ["honig"] },
      { ingredientId: 3, canonicalName: "Zucker", aliasName: "Zucker", tokens: ["zucker"] },
    ];
    const out = parseIngredientLines(
      ["1 g Tahin alternativ: Honig oder Zucker"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(3);
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].isAlternative).toBe(false);
    expect(out[1].ingredientId).toBe(2);
    expect(out[1].isAlternative).toBe(true);
    expect(out[2].ingredientId).toBe(3);
    expect(out[2].isAlternative).toBe(true);
  });

  it("'(alternativ X)' in parens WITHOUT a colon still adds X as an optional alternative", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 20, canonicalName: "Honig", aliasName: "Honig", tokens: ["honig"] },
      {
        ingredientId: 21,
        canonicalName: "Agavendicksaft",
        aliasName: "Agavendicksaft",
        tokens: ["agavendicksaft"],
      },
    ];
    const out = parseIngredientLines(
      ["2 EL flüssigen Honig (alternativ Agavendicksaft)"],
      makeLookups(catalog, ["EL"]),
    );
    expect(out).toHaveLength(2);
    expect(out[0].ingredientId).toBe(20);
    expect(out[0].isAlternative).toBe(false);
    expect(out[1].ingredientId).toBe(21);
    expect(out[1].isAlternative).toBe(true);
    expect(out[1].isOptional).toBe(true);
  });

  it("uses the matched alias as the name ('extra-virgin olive oil', not 'extra virgin …')", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 1,
        canonicalName: "Olivenöl",
        aliasName: "extra-virgin olive oil",
        tokens: ["extra", "virgin", "olive", "oil"],
      },
    ];
    const out = parseIngredientLines(
      ["2 teaspoons extra-virgin olive oil"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(1);
    // Name is the curated alias string verbatim — no tokenisation artefacts
    // ("extra virgin") and no source-span reconstruction.
    expect(out[0].name).toBe("extra-virgin olive oil");
    // Alias differs from canonical → canonical surfaces for the read view.
    expect(out[0].canonicalIngredientName).toBe("Olivenöl");
  });

  it("surfaces the original source span as sourceName when the alias replaced it", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 7,
        canonicalName: "Zwiebel",
        aliasName: "Zwiebel",
        tokens: ["zwiebel"],
      },
    ];
    const out = parseIngredientLines(["100 g Zwiebeln"], makeLookups(catalog));
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(7);
    // Display name is the matched alias…
    expect(out[0].name).toBe("Zwiebel");
    // …but the user's original spelling is preserved for the alias toggle.
    expect(out[0].sourceName).toBe("Zwiebeln");
  });

  it("English 'alternatively:' behaves the same as German 'alternativ:'", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Tahini", aliasName: "Tahini", tokens: ["tahini"] },
      { ingredientId: 2, canonicalName: "almond butter", aliasName: "almond butter", tokens: ["almond", "butter"] },
    ];
    const out = parseIngredientLines(
      ["1 g Tahini alternatively: 1 g almond butter"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("Tahini");
    expect(out[0].isAlternative).toBe(false);
    expect(out[1].name).toBe("almond butter");
    expect(out[1].isOptional).toBe(true);
    expect(out[1].isAlternative).toBe(true);
  });

  it("non-alternative expansions (Optional:, Garnish:, each:) leave isAlternative false", () => {
    const out = parseIngredientLines(
      [
        "Optional: 1 g Sesamsaat",
        "Garnish: cilantro, peanuts",
      ],
      makeLookups([]),
    );
    for (const row of out) {
      expect(row.isAlternative).toBe(false);
    }
  });

  it("'oder' / 'or' / ' / ' between two ingredient names splits into primary + optional alternative", () => {
    // The post-separator name needs to be in the catalog — otherwise the
    // alternative gets folded back into the primary's notes (see the
    // "unmatched alternative fold-back" describe block below).
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Zucker", aliasName: "Zucker", tokens: ["zucker"] },
      { ingredientId: 2, canonicalName: "Honig", aliasName: "Honig", tokens: ["honig"] },
      { ingredientId: 3, canonicalName: "Butter", aliasName: "Butter", tokens: ["butter"] },
      { ingredientId: 4, canonicalName: "Margarine", aliasName: "Margarine", tokens: ["margarine"] },
      { ingredientId: 5, canonicalName: "Tahini", aliasName: "Tahini", tokens: ["tahini"] },
      { ingredientId: 6, canonicalName: "almond butter", aliasName: "almond butter", tokens: ["almond", "butter"] },
    ];
    const cases: [string, string, string][] = [
      ["1 g Zucker oder Honig", "Zucker", "Honig"],
      ["100 g Butter / Margarine", "Butter", "Margarine"],
      ["1 g Zucker o. Honig", "Zucker", "Honig"],
      ["1 g Tahini or almond butter", "Tahini", "almond butter"],
    ];
    for (const [raw, primary, alt] of cases) {
      const out = parseIngredientLines([raw], makeLookups(catalog));
      expect(out, raw).toHaveLength(2);
      expect(out[0].name, raw).toBe(primary);
      expect(out[0].isAlternative, raw).toBe(false);
      expect(out[0].isOptional, raw).toBe(false);
      expect(out[1].name, raw).toBe(alt);
      expect(out[1].isAlternative, raw).toBe(true);
      expect(out[1].isOptional, raw).toBe(true);
    }
  });

  it("'or'/'oder' splits the WHOLE chain into one alternative per option", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Zucker", aliasName: "Zucker", tokens: ["zucker"] },
      { ingredientId: 2, canonicalName: "Honig", aliasName: "Honig", tokens: ["honig"] },
      { ingredientId: 3, canonicalName: "Sirup", aliasName: "Sirup", tokens: ["sirup"] },
    ];
    const out = parseIngredientLines(
      ["1 g Zucker oder Honig oder Sirup"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(3);
    expect(out.map((o) => o.name)).toEqual(["Zucker", "Honig", "Sirup"]);
    expect(out.map((o) => o.isAlternative)).toEqual([false, true, true]);
  });

  it("'or'/'oder' does NOT split when post-separator starts with a descriptor (modifier, not alternative)", () => {
    const out = parseIngredientLines(
      ["6 dried or fresh shiitake mushrooms"],
      makeLookups([]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toContain("shiitake mushrooms");
  });

  it("'oder' DOES split when the alternative starts with a descriptor but the primary has its own head noun", () => {
    // "brauner Zucker" leads with a descriptor ("brauner") yet is a complete
    // ingredient. The pre side "Rohrzucker" is a real noun (not headless like
    // "6 dried"), so the line is two alternatives, not a shared-head modifier.
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Rohrzucker", aliasName: "Rohrzucker", tokens: ["rohrzucker"] },
      {
        ingredientId: 2,
        canonicalName: "brauner Zucker",
        aliasName: "brauner Zucker",
        tokens: ["brauner", "zucker"],
      },
    ];
    const out = parseIngredientLines(
      ["2 EL Rohrzucker oder brauner Zucker"],
      makeLookups(catalog, ["EL"]),
    );
    expect(out).toHaveLength(2);
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].isAlternative).toBe(false);
    expect(out[1].ingredientId).toBe(2);
    expect(out[1].isAlternative).toBe(true);
  });

  it("dash-compound 'Weizen- oder Dinkelmehl' stays ONE ingredient when the stitched compound isn't in the catalog (no-hit fallback)", () => {
    // Empty catalog → the elision expander can't validate "Weizenmehl", so it
    // doesn't split; the line is kept as one ingredient. (The catalogued case —
    // which DOES split into Weizenmehl + Dinkelmehl — is covered below.)
    const out = parseIngredientLines(
      ["200 g Weizen- oder Dinkelmehl"],
      makeLookups([]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].name.toLowerCase()).toMatch(/weizen.*dinkelmehl|weizenmehl/);
  });

  describe("compound-elision expansion (German shared-suffix lists)", () => {
    it("'Weizen- oder Dinkelmehl' → Weizenmehl (primary) + Dinkelmehl (alt), borrowing 'mehl'", () => {
      const catalog: IngredientCatalog = [
        { ingredientId: 1, canonicalName: "Weizenmehl", aliasName: "Weizenmehl", tokens: ["weizenmehl"] },
        { ingredientId: 2, canonicalName: "Dinkelmehl", aliasName: "Dinkelmehl", tokens: ["dinkelmehl"] },
      ];
      const line = "200 g Weizen- oder Dinkelmehl";
      const out = parseIngredientLines([line], makeLookups(catalog));
      expect(out.map((r) => r.name)).toEqual(["Weizenmehl", "Dinkelmehl"]);
      expect(out[0].isAlternative).toBe(false);
      expect(out[1].isAlternative).toBe(true);
      expect(out.every((r) => r.quantity === 200)).toBe(true);
      // The primary "Weizenmehl" consumed "Weizen-" + the borrowed "mehl" of
      // "Dinkelmehl" — both highlighted as name on the original line.
      const names = (out[0].highlightParts ?? [])
        .filter((p) => p.kind === "name")
        .map((p) => line.slice(p.range[0], p.range[1]));
      expect(names).toEqual(["Weizen-", "mehl"]);
    });

    it("multi-stem list fans out into one row per stem + the head, sharing the amount; a missing dash ('Cashew') is tolerated", () => {
      const names = ["Mandeldrink", "Haferdrink", "Sojadrink", "Reisdrink", "Cashewdrink", "Kokosdrink"];
      const catalog: IngredientCatalog = names.map((n, i) => ({
        ingredientId: i + 1,
        canonicalName: n,
        aliasName: n,
        tokens: [n.toLowerCase()],
      }));
      const out = parseIngredientLines(
        ["500 ml Mandel-, Hafer-, Soja-, Reis-, Cashew oder Kokosdrink"],
        makeLookups(catalog, ["ml"]),
      );
      expect(out.map((r) => r.name)).toEqual(names);
      expect(out.every((r) => r.quantity === 500 && r.unit?.name === "ml")).toBe(true);
      expect(out[0].isAlternative).toBe(false);
      expect(out.slice(1).every((r) => r.isAlternative)).toBe(true);
    });

    it("does NOT expand a 'z. B.' example note — one ingredient, note kept verbatim", () => {
      const catalog: IngredientCatalog = [
        { ingredientId: 1, canonicalName: "Pflanzenmilch", aliasName: "Pflanzenmilch", tokens: ["pflanzenmilch"] },
        { ingredientId: 2, canonicalName: "Mandeldrink", aliasName: "Mandeldrink", tokens: ["mandeldrink"] },
        { ingredientId: 3, canonicalName: "Kokosdrink", aliasName: "Kokosdrink", tokens: ["kokosdrink"] },
      ];
      const out = parseIngredientLines(
        ["500 ml Pflanzenmilch (z. B. Mandel-, Hafer- oder Kokosdrink)"],
        makeLookups(catalog, ["ml"]),
      );
      expect(out).toHaveLength(1);
      expect(out[0].name).toBe("Pflanzenmilch");
      expect(out[0].notes).toMatch(/z\. ?B\. Mandel-, Hafer- oder Kokosdrink/);
    });

    it("no catalog hit → keeps the dash-compound as one ingredient (does not invent a split)", () => {
      const out = parseIngredientLines(["200 g Weizen- oder Dinkelmehl"], makeLookups([]));
      expect(out).toHaveLength(1);
    });
  });

  it("keeps a spaced numeric range dash in a note ('(ca. 150 - 200 g)')", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Paprika", aliasName: "Paprika", tokens: ["paprika"] },
    ];
    const out = parseIngredientLines(["1 Paprika (ca. 150 - 200 g)"], makeLookups(catalog));
    // The dash is a numeric range (150-200), not a clause separator — it survives.
    expect(out[0].notes).toBe("ca. 150 - 200 g");
  });

  it("a capitalized '/word' is an alternative, not a plural marker ('Dose/Glas' stays in the note)", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Kichererbsen", aliasName: "Kichererbsen", tokens: ["kichererbsen"] },
    ];
    const out = parseIngredientLines(["100 g Kichererbsen (aus der Dose/Glas)"], makeLookups(catalog));
    expect(out[0].name).toBe("Kichererbsen");
    // "Glas" is a word/alternative (capitalized), not a plural ending — the
    // whole "aus der Dose/Glas" stays in the note, Glas is not part of the name.
    expect(out[0].notes).toBe("aus der Dose/Glas");
  });

  it("attaches a post-unit connector ('Pinch of …') to the unit, even with a leading prep before the match", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "red pepper flakes", aliasName: "red pepper flakes", tokens: ["red", "pepper", "flakes"] },
    ];
    const out = parseIngredientLines(
      ["Pinch of crushed red pepper flakes"],
      makeLookups(catalog, ["pinch"]),
    );
    expect(out[0].name).toBe("red pepper flakes");
    // "of" belongs to the unit (highlighted with it), NOT the notes; the leading
    // prep "crushed" stays in the notes.
    expect(out[0].notes).toBe("crushed");
  });

  it("matches a soft-hyphenated line ('Knob­lauch') to the clean catalog name", () => {
    // Recipe sources sprinkle soft hyphens (U+00AD) for hyphenation; they must
    // be stripped for matching or every word looks like a new ingredient.
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Knoblauch", aliasName: "Knoblauch", tokens: ["knoblauch"] },
    ];
    const line = "2 Zehen Knob\u00ADlauch"; // \u00AD = soft hyphen
    const out = parseIngredientLines([line], makeLookups(catalog, ["zehen"]));
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].ingredientMatch).toBe("existing");
    expect(out[0].name).toBe("Knoblauch");
  });

  it("'alternative' / 'alternativly' word (with or without colon) splits into primary + optional alternative", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Tahini", aliasName: "Tahini", tokens: ["tahini"] },
      { ingredientId: 2, canonicalName: "almond butter", aliasName: "almond butter", tokens: ["almond", "butter"] },
    ];
    const cases: [string, string, string][] = [
      ["1 g Tahini alternative 1 g almond butter", "Tahini", "almond butter"],
      ["1 g Tahini alternativly: 1 g almond butter", "Tahini", "almond butter"],
    ];
    for (const [raw, primary, alt] of cases) {
      const out = parseIngredientLines([raw], makeLookups(catalog));
      expect(out, raw).toHaveLength(2);
      expect(out[0].name, raw).toBe(primary);
      expect(out[0].isAlternative, raw).toBe(false);
      expect(out[1].name, raw).toBe(alt);
      expect(out[1].isAlternative, raw).toBe(true);
    }
  });

it("'<qty> <unit> each: A, B, C' fans out into one row per item sharing qty + unit", () => {
    const out = parseIngredientLines(
      ["1 teaspoon each: ground cumin, chili powder, garlic powder"],
      makeLookups([], ["teaspoon"]),
    );
    expect(out).toHaveLength(3);
    for (const row of out) {
      expect(row.quantity).toBe(1);
      expect(row.unit?.name).toBe("teaspoon");
    }
    // "ground" is in PREP_LEADING_TOKENS → strips to notes; the bare noun
    // stays in the name field.
    expect(out.map((i) => i.name)).toEqual([
      "cumin",
      "chili powder",
      "garlic powder",
    ]);
    expect(out[0].notes).toMatch(/ground/i);
  });

  it("equipment-flagged ingredients default the row to isOptional=true", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 42,
        canonicalName: "Backpapier",
        aliasName: "Backpapier",
        tokens: ["backpapier"],
        isEquipment: true,
      },
      {
        ingredientId: 7,
        canonicalName: "Mehl",
        aliasName: "Mehl",
        tokens: ["mehl"],
      },
    ];
    const out = parseIngredientLines(
      ["1 Backpapier", "200 g Mehl"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(2);
    // Equipment item → auto-optional even though the parsed line had no
    // explicit "optional" marker.
    expect(out[0].ingredientId).toBe(42);
    expect(out[0].isOptional).toBe(true);
    // Non-equipment item → optional stays false.
    expect(out[1].ingredientId).toBe(7);
    expect(out[1].isOptional).toBe(false);
  });

  it("section-aware parser also defaults equipment rows to isOptional=true", () => {
    // Familywall imports flow through parseIngredientLinesIntoSections;
    // the flat-variant equipment override must apply here too so equipment
    // doesn't sneak onto the recipe non-optional just because it was
    // imported from a sectioned source.
    const catalog: IngredientCatalog = [
      {
        ingredientId: 42,
        canonicalName: "Backpapier",
        aliasName: "Backpapier",
        tokens: ["backpapier"],
        isEquipment: true,
      },
      {
        ingredientId: 7,
        canonicalName: "Mehl",
        aliasName: "Mehl",
        tokens: ["mehl"],
      },
    ];
    const groups = parseIngredientLinesIntoSections(
      ["Für den Teig:", "1 Backpapier", "200 g Mehl"],
      makeLookups(catalog),
    );
    const teig = groups.find((g) => g.title === "Für den Teig");
    expect(teig).toBeDefined();
    const backpapier = teig?.ingredients.find((i) => i.ingredientId === 42);
    const mehl = teig?.ingredients.find((i) => i.ingredientId === 7);
    expect(backpapier?.isOptional).toBe(true);
    expect(mehl?.isOptional).toBe(false);
  });

  it("equipment override doesn't undo an explicit non-optional manual edit", () => {
    // The equipment override is ORed in, so a parsed `isOptional=true` from
    // explicit marker text still wins, and the override only LIFTS rows
    // from non-optional to optional — never the reverse.
    const catalog: IngredientCatalog = [
      {
        ingredientId: 42,
        canonicalName: "Backpapier",
        aliasName: "Backpapier",
        tokens: ["backpapier"],
        isEquipment: true,
      },
    ];
    const out = parseIngredientLines(
      ["1 Backpapier (optional)"],
      makeLookups(catalog),
    );
    expect(out[0].isOptional).toBe(true);
  });

  it("colon-amount lines like 'Mehl: 500 g' are still parsed as ingredients", () => {
    // The parser's colon-amount preprocess rewrites "Mehl: 500 g" to
    // "500 g Mehl" — the resulting parsed.name has no colon, so the
    // new section-header heuristic does NOT fire here.
    const out = parseIngredientLines(
      ["Mehl: 500 g"],
      makeLookups([]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Mehl");
    expect(out[0].quantity).toBe(500);
  });
});

describe("parseIngredientLines — unmatched alternative → proposed row", () => {
  it("emits an unmatched 'oder' alternative as its own (new-ingredient) row", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Mehl", aliasName: "Mehl", tokens: ["mehl"] },
    ];
    const out = parseIngredientLines(
      ["200 g Mehl oder Stärke"],
      makeLookups(catalog),
    );
    // A NAMED unmatched alternative is now proposed (the user can create it,
    // alias it, or delete it → fold), not silently folded into the note.
    expect(out).toHaveLength(2);
    expect(out[0].ingredientId).toBe(1);
    expect(out[1].name).toBe("Stärke");
    expect(out[1].isAlternative).toBe(true);
    expect(out[1].ingredientMatch).toBe("new");
  });

  it("keeps a matched 'oder' alternative as its own row", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Mehl", aliasName: "Mehl", tokens: ["mehl"] },
      { ingredientId: 2, canonicalName: "Stärke", aliasName: "Stärke", tokens: ["starke"] },
    ];
    const out = parseIngredientLines(
      ["200 g Mehl oder Stärke"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(2);
    expect(out[0].ingredientId).toBe(1);
    expect(out[1].ingredientId).toBe(2);
    expect(out[1].isAlternative).toBe(true);
  });

  it("emits an unmatched English 'or' alternative as its own row", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Butter", aliasName: "Butter", tokens: ["butter"] },
    ];
    const out = parseIngredientLines(
      ["100 g Butter or Margarine"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(2);
    expect(out[1].name).toBe("Margarine");
    expect(out[1].isAlternative).toBe(true);
    expect(out[1].ingredientMatch).toBe("new");
  });

  it("keeps the alternative's own quantity on its row", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Mehl", aliasName: "Mehl", tokens: ["mehl"] },
    ];
    const out = parseIngredientLines(
      ["200 g Mehl oder 100 g Stärke"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(2);
    expect(out[1].name).toBe("Stärke");
    expect(out[1].quantity).toBe(100);
    expect(out[1].isAlternative).toBe(true);
  });

  it("force-folds a specified alternative range into the primary's note (delete-on-reparse)", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Mehl", aliasName: "Mehl", tokens: ["mehl"] },
    ];
    const line = "200 g Mehl oder Stärke";
    // First parse normally — Stärke is its own alternative row.
    const normal = parseIngredientLines([line], makeLookups(catalog));
    expect(normal).toHaveLength(2);
    const altRange = normal[1].sourceRange!;
    // Re-parse asking that range to fold (the user deleted the alternative).
    const folded = parseIngredientLines([line], makeLookups(catalog), {
      forceFoldRanges: [altRange],
    });
    expect(folded).toHaveLength(1);
    expect(folded[0].ingredientId).toBe(1);
    expect(folded[0].notes).toMatch(/oder Stärke/);
  });

  it("emits the unmatched alternative as its own row when there is no primary to fold into", () => {
    const out = parseIngredientLines(
      ["(Alternativ: Stärke)"],
      makeLookups([]),
    );
    // Bare "(Alternativ: X)" with no primary text emits a single standalone
    // row — there's no primary to fold into, so the row stays.
    expect(out).toHaveLength(1);
    expect(out[0].name).toMatch(/Stärke/);
  });

  it("emits an unmatched 'alternativ:' tail as its own row", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Tahin", aliasName: "Tahin", tokens: ["tahin"] },
    ];
    const out = parseIngredientLines(
      ["1 EL Tahin alternativ: 1 EL Mandelmus"],
      makeLookups(catalog, ["el"]),
    );
    expect(out).toHaveLength(2);
    expect(out[0].ingredientId).toBe(1);
    expect(out[1].name).toBe("Mandelmus");
    expect(out[1].isAlternative).toBe(true);
  });

  it("emits an unmatched '(Alternativ: …)' tail as its own row", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Mehl", aliasName: "Mehl", tokens: ["mehl"] },
    ];
    const out = parseIngredientLines(
      ["200 g Mehl (Alternativ: Stärke)"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(2);
    expect(out[0].ingredientId).toBe(1);
    expect(out[1].name).toBe("Stärke");
    expect(out[1].isAlternative).toBe(true);
  });

  it("scopes the alternative to the current input line (no leak across lines)", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Mehl", aliasName: "Mehl", tokens: ["mehl"] },
      { ingredientId: 2, canonicalName: "Butter", aliasName: "Butter", tokens: ["butter"] },
    ];
    const out = parseIngredientLines(
      [
        "200 g Mehl",
        "100 g Butter oder Margarine",
      ],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(3);
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].notes).toBeNull();
    expect(out[1].ingredientId).toBe(2);
    expect(out[1].isAlternative).toBe(false);
    expect(out[2].name).toBe("Margarine");
    expect(out[2].isAlternative).toBe(true);
  });

  it("section variant: emits an unmatched alternative as a row within its section", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Mehl", aliasName: "Mehl", tokens: ["mehl"] },
    ];
    const groups = parseIngredientLinesIntoSections(
      ["200 g Mehl oder Stärke"],
      makeLookups(catalog),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].ingredients).toHaveLength(2);
    expect(groups[0].ingredients[0].ingredientId).toBe(1);
    expect(groups[0].ingredients[1].name).toBe("Stärke");
    expect(groups[0].ingredients[1].isAlternative).toBe(true);
  });
});

describe("span-based name/notes on auto-pick", () => {
  function single(line: string, catalog: IngredientCatalog, units: string[] = []) {
    const out = parseIngredientLines([line], makeLookups(catalog, units));
    return out[0];
  }
  const cat: IngredientCatalog = [
    { ingredientId: 1, canonicalName: "Salt", aliasName: "Salt", tokens: ["salt"] },
    { ingredientId: 2, canonicalName: "red wine", aliasName: "red wine", tokens: ["red", "wine"] },
    { ingredientId: 3, canonicalName: "chick peas", aliasName: "chick peas", tokens: ["chick", "peas"] },
    { ingredientId: 4, canonicalName: "olive oil", aliasName: "olive oil", tokens: ["olive", "oil"] },
    { ingredientId: 5, canonicalName: "carrot", aliasName: "carrot", tokens: ["carrot"] },
  ];

  it("Salt divided → Salt, note divided", () => {
    const row = single("1 g Salt divided", cat);
    expect(row.ingredientMatch).toBe("existing");
    expect(row.name).toBe("Salt");
    expect(row.notes).toBe("divided");
  });

  it("carrot, peeled and sliced → carrot, note 'peeled and sliced'", () => {
    const row = single("1 carrot, peeled and sliced", cat);
    expect(row.name).toBe("carrot");
    expect(row.notes).toBe("peeled and sliced");
  });

  it("dry red wine → red wine, note dry", () => {
    const row = single("1 g dry red wine", cat);
    expect(row.name).toBe("red wine");
    expect(row.notes).toBe("dry");
  });

  it("frozen chick peas in a can → chick peas, note 'frozen, in a can'", () => {
    const row = single("1 frozen chick peas in a can", cat);
    expect(row.name).toBe("chick peas");
    expect(row.notes).toBe("frozen, in a can");
  });

  it("each candidate carries its own finished name/notes", () => {
    const row = single("1 frozen chick peas in a can", cat);
    const top = row.candidateMatches[0];
    expect(top.name).toBe("chick peas");
    expect(top.notes).toBe("frozen, in a can");
  });
});

describe("alternative amount/unit/notes inheritance", () => {
  function rows(line: string, catalog: IngredientCatalog, units: string[] = []) {
    return parseIngredientLines([line], makeLookups(catalog, units));
  }
  const cat: IngredientCatalog = [
    { ingredientId: 1, canonicalName: "butter", aliasName: "butter", tokens: ["butter"] },
    { ingredientId: 2, canonicalName: "margarine", aliasName: "margarine", tokens: ["margarine"] },
    { ingredientId: 3, canonicalName: "egg", aliasName: "egg", tokens: ["egg"] },
    { ingredientId: 4, canonicalName: "egg white", aliasName: "egg white", tokens: ["egg", "white"] },
    { ingredientId: 5, canonicalName: "bacon", aliasName: "bacon", tokens: ["bacon"] },
    { ingredientId: 6, canonicalName: "pancetta", aliasName: "pancetta", tokens: ["pancetta"] },
    { ingredientId: 7, canonicalName: "onion", aliasName: "onion", tokens: ["onion"] },
    { ingredientId: 8, canonicalName: "shallot", aliasName: "shallot", tokens: ["shallot"] },
  ];

  it("alt with no amount/unit inherits the primary's", () => {
    const out = rows("200 g butter or margarine", cat);
    const primary = out[0];
    const alt = out.find((r) => r.isAlternative)!;
    expect(alt.quantity).toBe(200);
    expect(alt.unit?.name).toBe(primary.unit?.name);
    expect(alt.fixedAmount).toBe(primary.fixedAmount);
  });

  it("alt that brought its own quantity keeps it", () => {
    const out = rows("2 eggs or 3 egg whites", cat);
    const alt = out.find((r) => r.isAlternative)!;
    expect(alt.quantity).toBe(3);
  });

  it("trailing note of the last member propagates to siblings without their own", () => {
    const out = rows("2 g bacon or pancetta, diced", cat);
    const bacon = out[0];
    const pancetta = out.find((r) => r.isAlternative)!;
    expect(pancetta.notes).toBe("diced");
    expect(bacon.notes).toBe("diced");
  });

  it("members with their own note keep it (no propagation)", () => {
    const out = rows("1 onion, finely chopped, or 2 shallots, diced", cat);
    expect(out[0].notes).toMatch(/finely chopped/);
    expect(out.find((r) => r.isAlternative)!.notes).toMatch(/diced/);
  });

  it("captures categorised highlight parts: own segment + inherited amount", () => {
    const out = rows("2-3 EL Honig oder Ahornsirup", [
      { ingredientId: 1, canonicalName: "Honig", aliasName: "Honig", tokens: ["honig"] },
      { ingredientId: 2, canonicalName: "Ahornsirup", aliasName: "Ahornsirup", tokens: ["ahornsirup"] },
    ], ["el"]);
    const primary = out[0];
    const alt = out.find((r) => r.isAlternative)!;
    const slice = (r: typeof out[0], range: [number, number]) =>
      r.rawText!.slice(range[0], range[1]);
    expect(slice(primary, primary.sourceRange!)).toBe("2-3 EL Honig");
    expect(slice(alt, alt.sourceRange!)).toBe("oder Ahornsirup");
    // Primary parts: "2-3 EL" → amount, "Honig" → name.
    const pAmount = primary.highlightParts!.find((p) => p.kind === "amount")!;
    const pName = primary.highlightParts!.find((p) => p.kind === "name")!;
    expect(slice(primary, pAmount.range)).toBe("2-3 EL");
    expect(slice(primary, pName.range)).toBe("Honig");
    // The alt inherited "2-3 EL" → carried as an amount part on its own line.
    const altAmount = alt.highlightParts!.filter((p) => p.kind === "amount");
    expect(altAmount.map((p) => slice(alt, p.range))).toContain("2-3 EL");
  });

  it("'nach Belieben' survives as a to-taste note on a matched alternative", () => {
    const out = rows("100 g Rohrohrzucker (oder anderer Zucker nach Belieben)", [
      { ingredientId: 1, canonicalName: "Rohrohrzucker", aliasName: "Rohrohrzucker", tokens: ["rohrohrzucker"] },
      { ingredientId: 2, canonicalName: "Zucker", aliasName: "Zucker", tokens: ["zucker"] },
    ]);
    const alt = out.find((r) => r.isAlternative)!;
    expect(alt.ingredientId).toBe(2);
    expect(alt.notes).toMatch(/nach Belieben/i);
  });

  it("'nach Belieben' on a primary routes to notes (not optional)", () => {
    const out = rows("Salz nach Belieben", [
      { ingredientId: 1, canonicalName: "Salz", aliasName: "Salz", tokens: ["salz"] },
    ]);
    expect(out[0].name).toBe("Salz");
    expect(out[0].isOptional).toBe(false);
    expect(out[0].notes).toMatch(/nach Belieben/i);
  });

  it("an optional marker on an alternative makes the whole block optional", () => {
    const out = rows("2 EL Hefeflocken (oder Veganer Parmesan, optional)", [
      { ingredientId: 1, canonicalName: "Hefeflocken", aliasName: "Hefeflocken", tokens: ["hefeflocken"] },
      { ingredientId: 2, canonicalName: "Veganer Parmesan", aliasName: "Veganer Parmesan", tokens: ["veganer", "parmesan"] },
    ], ["el"]);
    const primary = out[0];
    const alt = out.find((r) => r.isAlternative)!;
    expect(primary.isOptional).toBe(true); // whole block optional
    expect(alt.isOptional).toBe(true);
    // "optional" is a flag, not note text.
    expect(primary.notes ?? "").not.toMatch(/optional/i);
    expect(alt.notes ?? "").not.toMatch(/optional/i);
  });

  it("folds a nameless alternative (amount-only, e.g. '1/2 large head') into notes", () => {
    const out = rows("1 small head cabbage (or 1/2 large head, shredded)", [
      { ingredientId: 1, canonicalName: "cabbage", aliasName: "cabbage", tokens: ["cabbage"] },
    ], ["head"]);
    expect(out).toHaveLength(1); // no orphan row for the nameless alt
    expect(out[0].name).toBe("cabbage");
    // The whole parenthetical is preserved in the notes, not dropped.
    expect(out[0].notes).toMatch(/or 1\/2 large head, shredded/i);
    // …and shown as a note span on the source line.
    const noteSlices = (out[0].highlightParts ?? [])
      .filter((p) => p.kind === "note")
      .map((p) => out[0].rawText!.slice(p.range[0], p.range[1]));
    expect(noteSlices.some((s) => /1\/2 large head, shredded/i.test(s))).toBe(true);
  });

  it("emits unmatched named alternatives as their own rows", () => {
    const out = rows("50 g gesalzene Erdnüsse (oder ungesalzen, oder andere Nüsse)", [
      { ingredientId: 1, canonicalName: "Erdnüsse", aliasName: "Erdnüsse", tokens: ["erdnüsse"] },
      { ingredientId: 2, canonicalName: "Nüsse", aliasName: "Nüsse", tokens: ["nüsse"] },
    ]);
    // Each unmatched alternative is now a proposed row (the user folds the noise
    // by deleting it). "ungesalzen" and "andere Nüsse" become alternative rows.
    const altNames = out.filter((r) => r.isAlternative).map((r) => r.name);
    expect(altNames).toEqual(["ungesalzen", "andere Nüsse"]);
  });

  it("splits a multi-option parenthetical alternative into proposed rows", () => {
    const out = rows(
      "2 EL Honig (oder anderes Süßungsmittel, etwa Zucker, Reis oder Rübensirup)",
      [{ ingredientId: 1, canonicalName: "Honig", aliasName: "Honig", tokens: ["honig"] }],
      ["el"],
    );
    expect(out[0].name).toBe("Honig");
    expect(out[0].isAlternative).toBe(false);
    // The "oder" chain splits into alternative rows; "etwa Zucker, Reis" rides
    // along as the first alternative's note. No comma invented before "oder".
    const alts = out.filter((r) => r.isAlternative);
    expect(alts.map((r) => r.name)).toEqual(["anderes Süßungsmittel", "Rübensirup"]);
    expect(alts[0].notes).toBe("etwa Zucker, Reis");
  });

  it("keeps a non-fraction slash in the notes on the matched path", () => {
    // "(14 tbsp / 1¾ sticks)" — the slash must survive into the matched row's
    // notes, not be swallowed when the candidate tokens are re-joined.
    const out = rows(
      "200g (14 tbsp / 1¾ sticks) unsalted butter, clarified",
      [{ ingredientId: 1, canonicalName: "butter", aliasName: "butter", tokens: ["butter"] }],
      ["tbsp", "stick", "sticks"],
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("butter");
    // AST parser keeps the source verbatim: "1¾" had no space in the input, so
    // no space is invented (was "1 ¾" under the old token-rejoining notes).
    expect(out[0].notes).toContain("14 tbsp / 1¾ sticks");
  });

  it("keeps a semicolon in the notes on the matched path", () => {
    // "(1-inch; about 10 cups)" — the semicolon must survive into the matched
    // row's notes, not be swallowed when the candidate tokens are re-joined
    // (the candidate tokenizer split on ";" without remembering it).
    const out = rows(
      "12 ounces crusty whole-wheat bread, cubed (1-inch; about 10 cups)",
      [{ ingredientId: 1, canonicalName: "bread", aliasName: "bread", tokens: ["bread"] }],
      ["ounce", "ounces"],
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("bread");
    expect(out[0].notes).toContain("1-inch; about 10 cups");
  });

  it("keeps a note tail after a parenthetical alternative in source order", () => {
    // "(or 1 large clove), peeled" — the alternative folds into notes and the
    // trailing "peeled" must come AFTER it, not jump ahead of it.
    const out = rows(
      "2 small garlic cloves (or 1 large clove), peeled",
      [{ ingredientId: 1, canonicalName: "garlic", aliasName: "garlic", tokens: ["garlic"] }],
      ["clove", "cloves"],
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("garlic");
    expect(out[0].notes).toBe("small, or 1 large clove, peeled");
  });

  it("commas off a leading descriptor from a folded alt when the matched name was between them", () => {
    // "red" precedes the matched "chili powder", which is stripped, then the
    // "(or to taste)" note follows — so the note must read "red, or to taste":
    // the comma stands in for the removed "chili powder".
    const out = rows(
      "1/4 teaspoon red chili powder (or to taste)",
      [{ ingredientId: 1, canonicalName: "chili powder", aliasName: "chili powder", tokens: ["chili", "powder"] }],
      ["teaspoon"],
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("chili powder");
    expect(out[0].notes).toBe("red, or to taste");
  });

  it("does not strike the alternative's own unit (½ TL Natron (oder 1 TL Backpulver))", () => {
    const out = rows("½ TL Natron (oder 1 TL Backpulver)", [
      { ingredientId: 1, canonicalName: "Natron", aliasName: "Natron", tokens: ["natron"] },
      { ingredientId: 2, canonicalName: "Backpulver", aliasName: "Backpulver", tokens: ["backpulver"] },
    ], ["tl"]);
    const alt = out.find((r) => r.isAlternative)!;
    const slice = (rg: [number, number]) => alt.rawText!.slice(rg[0], rg[1]);
    // "1 TL" is the alt's amount → coloured amount, never dropped.
    const amountParts = alt.highlightParts!.filter((p) => p.kind === "amount");
    expect(amountParts.map((p) => slice(p.range))).toContain("1 TL");
    // No "TL" is struck through.
    const dropped = alt.highlightParts!.filter((p) => p.kind === "dropped");
    expect(dropped.some((p) => /TL/.test(slice(p.range)))).toBe(false);
    // The connector "oder" IS struck.
    expect(dropped.some((p) => slice(p.range).toLowerCase() === "oder")).toBe(true);
  });

  it("captures the shared note as a note part on a sibling that inherits it", () => {
    const out = rows("2 g bacon or pancetta, diced", [
      { ingredientId: 5, canonicalName: "bacon", aliasName: "bacon", tokens: ["bacon"] },
      { ingredientId: 6, canonicalName: "pancetta", aliasName: "pancetta", tokens: ["pancetta"] },
    ]);
    const bacon = out[0];
    const noteSlices = (bacon.highlightParts ?? [])
      .filter((p) => p.kind === "note")
      .map((p) => bacon.rawText!.slice(p.range[0], p.range[1]));
    expect(noteSlices.some((s) => /diced/.test(s))).toBe(true);
  });

  it("a note inside a paren alternative stays local (not shared with the primary)", () => {
    const out = rows("Salz (oder Pfeffer, frisch gemahlen)", [
      { ingredientId: 1, canonicalName: "Salz", aliasName: "Salz", tokens: ["salz"] },
      { ingredientId: 2, canonicalName: "Pfeffer", aliasName: "Pfeffer", tokens: ["pfeffer"] },
    ]);
    const salz = out[0];
    const pfeffer = out.find((r) => r.isAlternative)!;
    expect(pfeffer.notes).toMatch(/frisch gemahlen/);
    expect(salz.notes ?? "").not.toMatch(/frisch gemahlen/);
  });

  it("an alt that inherits the amount also inherits the range note", () => {
    const out = rows("2-3 EL Honig oder Ahornsirup", [
      { ingredientId: 1, canonicalName: "Honig", aliasName: "Honig", tokens: ["honig"] },
      { ingredientId: 2, canonicalName: "Ahornsirup", aliasName: "Ahornsirup", tokens: ["ahornsirup"] },
    ], ["el"]);
    const primary = out[0];
    const alt = out.find((r) => r.isAlternative)!;
    expect(primary.notes).toMatch(/2-3/);
    expect(alt.quantity).toBe(3);
    expect(alt.notes).toMatch(/2-3/);
  });

  it("mirrors the inherited shared note onto the primary's candidate matches", () => {
    // Picking a candidate from the pill UI replaces the row's notes with the
    // candidate's own `notes`. The shared prep ("diced") must therefore be
    // present on the primary's candidates too, or clicking one would drop it.
    const out = rows("2 g bacon or pancetta, diced", cat);
    const bacon = out[0];
    expect(bacon.notes).toBe("diced");
    expect(bacon.candidateMatches.length).toBeGreaterThan(0);
    for (const c of bacon.candidateMatches) {
      expect(c.notes).toMatch(/diced/);
    }
  });

  it("does NOT push the shared note onto a sibling that kept its own", () => {
    const out = rows("1 onion, finely chopped, or 2 shallots, diced", cat);
    const onion = out[0];
    // Onion kept "finely chopped" — its candidates must not gain "diced".
    for (const c of onion.candidateMatches) {
      expect(c.notes ?? "").not.toMatch(/diced/);
    }
  });
});

describe("internal comma preservation in matched name", () => {
  it("keeps the comma when the matched alias contains one", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 1,
        canonicalName: "Tomaten, passiert",
        aliasName: "Tomaten, passiert",
        tokens: ["tomaten", "passiert"],
      },
    ];
    const out = parseIngredientLines(
      ["500 g Tomaten, passiert"],
      makeLookups(catalog),
    );
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].name).toBe("Tomaten, passiert");
    expect(out[0].notes).toBeNull();
  });

  it("drops the comma when the matched alias has none", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 2,
        canonicalName: "Paprikapulver",
        aliasName: "Paprikapulver rosenscharf",
        tokens: ["paprikapulver", "rosenscharf"],
      },
    ];
    const out = parseIngredientLines(
      ["1 g Paprikapulver, rosenscharf"],
      makeLookups(catalog),
    );
    expect(out[0].name).toBe("Paprikapulver rosenscharf");
  });
});

describe("note fragments keep source order, comma-separated", () => {
  it("range note leads, trailing usage follows (matched ingredient)", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 1,
        canonicalName: "vegetable oil",
        aliasName: "vegetable oil",
        tokens: ["vegetable", "oil"],
      },
    ];
    const out = parseIngredientLines(
      ["2-3 cups vegetable oil, for frying"],
      makeLookups(catalog, ["cups"]),
    );
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].name).toBe("vegetable oil");
    // The range note carries its unit ("2-3 cups"), like on the unmatched path.
    expect(out[0].notes).toBe("2-3 cups, for frying");
  });

  it("size, paren amount, then comma-tail prep — all comma-separated, in order (new ingredient)", () => {
    const out = parseIngredientLines(
      ["1/2 pound (225g) large shrimp, peeled and deveined"],
      makeLookups([], ["pound"]),
    );
    expect(out[0].ingredientMatch).toBe("new");
    expect(out[0].name).toBe("shrimp");
    // "(225g)" had no space in the source; AST keeps it verbatim (was "225 g").
    expect(out[0].notes).toBe("225g, large, peeled and deveined");
  });

  it("skips the per-alias rename when the default unit is skipped (no amount)", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 5,
        canonicalName: "Knoblauch",
        aliasName: "Knoblauchzehe",
        tokens: ["knoblauchzehe"],
        defaultUnit: { id: 99, name: "Zehe" },
        displayName: "Knoblauch",
      },
    ];
    // With an amount: default unit + rename both apply ("3 Zehe Knoblauch").
    const withQty = parseIngredientLines(["3 Knoblauchzehe"], makeLookups(catalog));
    expect(withQty[0].unit?.id).toBe(99);
    expect(withQty[0].name).toBe("Knoblauch");

    // No amount: the default unit "Zehe" is dropped, so renaming to "Knoblauch"
    // would silently lose the "Zehe" meaning — keep the source name instead.
    const noQty = parseIngredientLines(["Knoblauchzehe"], makeLookups(catalog));
    expect(noQty[0].ingredientId).toBe(5);
    expect(noQty[0].unit).toBeNull();
    expect(noQty[0].name).toBe("Knoblauchzehe");
  });

  it("per-alias displayName renames a matched alias: '3 Knoblauchzehen' → 3 Zehe Knoblauch", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 5,
        canonicalName: "Knoblauch",
        aliasName: "Knoblauchzehen",
        tokens: ["knoblauchzehen"],
        defaultUnit: { id: 99, name: "Zehe" },
        displayName: "Knoblauch",
      },
    ];
    const out = parseIngredientLines(["3 Knoblauchzehen"], makeLookups(catalog));
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(5);
    expect(out[0].quantity).toBe(3);
    expect(out[0].unit?.id).toBe(99);
    // Configured rename → "Knoblauch" (== canonical, so no badge).
    expect(out[0].name).toBe("Knoblauch");
    expect(out[0].canonicalIngredientName).toBeNull();
  });

  it("applies a matched ingredient's default unit only when the line carries a quantity", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 8,
        canonicalName: "Eisbergsalat",
        aliasName: "Eisbergsalat",
        tokens: ["eisbergsalat"],
        defaultUnit: { id: 42, name: "Kopf" },
      },
    ];
    // With a quantity, the default unit fills in the missing unit slot.
    const withQty = parseIngredientLines(["2 Eisbergsalat"], makeLookups(catalog));
    expect(withQty[0].ingredientId).toBe(8);
    expect(withQty[0].quantity).toBe(2);
    expect(withQty[0].unit?.id).toBe(42);

    // No amount ("n. B." = nach Belieben) → no quantity → the default unit
    // must NOT be applied; a bare "Kopf Eisbergsalat" makes no sense.
    const noQty = parseIngredientLines(["n. B. Eisbergsalat"], makeLookups(catalog));
    expect(noQty[0].ingredientId).toBe(8);
    expect(noQty[0].quantity).toBeNull();
    expect(noQty[0].isOptional).toBe(true);
    expect(noQty[0].unit).toBeNull();
  });

  it("displayName can be any language/text, independent of the canonical", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 5,
        canonicalName: "Knoblauch",
        aliasName: "garlic cloves",
        tokens: ["garlic", "cloves"],
        displayName: "garlic",
      },
    ];
    const out = parseIngredientLines(["garlic cloves"], makeLookups(catalog));
    expect(out[0].ingredientId).toBe(5);
    // Shows the configured English rename, not the German canonical; the
    // canonical is still surfaced as the badge.
    expect(out[0].name).toBe("garlic");
    expect(out[0].canonicalIngredientName).toBe("Knoblauch");
  });

  it("an alias with no displayName shows the matched alias verbatim", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 7,
        canonicalName: "Olivenöl",
        aliasName: "Olivenöl extra virgin",
        tokens: ["olivenol", "extra", "virgin"],
        defaultUnit: { id: 3, name: "ml" },
      },
    ];
    const out = parseIngredientLines(
      ["Olivenöl extra virgin"],
      makeLookups(catalog),
    );
    expect(out[0].ingredientId).toBe(7);
    expect(out[0].name).toBe("Olivenöl extra virgin");
  });
});

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

  it("does NOT re-split trusted groups on header-looking lines", () => {
    // In the flat heuristic path an ALL-CAPS word like "MARINADE" would start
    // a new section; inside a structurally-known group it must stay put and
    // never create a section.
    const out = parseIngredientGroupsIntoSections(
      [{ title: "Sauce", lines: ["1 g Ketchup", "MARINADE"] }],
      makeLookups([]),
    );
    expect(out.map((g) => g.title)).toEqual(["Sauce"]);
  });

  it("keeps a bare colon-suffixed item inside a trusted group", () => {
    // "Salz:" would fire detectSectionHeader in the flat path; in a trusted
    // group it stays an ingredient row of the declared section.
    const out = parseIngredientGroupsIntoSections(
      [{ title: "Sauce", lines: ["200 g Tomaten", "Salz:"] }],
      makeLookups([]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Sauce");
    expect(out[0].ingredients.map((i) => i.name)).toEqual(["Tomaten", "Salz"]);
  });

  it("still expands 'Title: item' lines inside trusted groups (inner machinery)", () => {
    // The expansion pass (list-after-colon, Optional:, alternativ:) is NOT
    // gated by trust — only raw-line detectSectionHeader is. A combined
    // header+item line therefore still opens a section in both modes.
    const out = parseIngredientGroupsIntoSections(
      [{ title: "Sauce", lines: ["200 g Tomaten", "Topping: Käse"] }],
      makeLookups([]),
    );
    expect(out.map((g) => g.title)).toEqual(["Sauce", "Topping"]);
    expect(out[1].ingredients.map((i) => i.name)).toEqual(["Käse"]);
  });

  it("flat wrapper still detects text headers (behavior unchanged)", () => {
    const out = parseIngredientLinesIntoSections(
      ["1 g Butter", "Frosting:", "2 g Zucker"],
      makeLookups([]),
    );
    expect(out.map((g) => g.title)).toEqual([null, "Frosting"]);
  });
});

describe("vocab rules apply only on the no-match path", () => {
  // Matching sees the pristine line; "to taste" / "zum X" / "z.B. X" words
  // reach the notes of a MATCHED row via the uncovered-tokens fallback
  // (verbatim, source order) and are stripped from a NEW ingredient's
  // proposed name via stripVocabTail.
  const catalog: IngredientCatalog = [
    {
      ingredientId: 1,
      canonicalName: "Pfeffer",
      aliasName: "Pfeffer",
      tokens: ["pfeffer"],
    },
    {
      ingredientId: 2,
      canonicalName: "Puderzucker",
      aliasName: "Puderzucker",
      tokens: ["puderzucker"],
    },
    {
      ingredientId: 3,
      canonicalName: "Salz",
      aliasName: "salt",
      tokens: ["salt"],
    },
    { ingredientId: 4, canonicalName: "Öl", aliasName: "Öl", tokens: ["ol"] },
    {
      ingredientId: 5,
      canonicalName: "Olivenöl",
      aliasName: "Olivenöl",
      tokens: ["olivenol"],
    },
  ];

  it("matched: 'Pfeffer nach Geschmack' → phrase becomes a verbatim note", () => {
    const out = parseIngredientLines(["Pfeffer nach Geschmack"], makeLookups(catalog));
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].name).toBe("Pfeffer");
    expect(out[0].notes).toBe("nach Geschmack");
  });

  it("matched: 'Etwas Puderzucker zum Bestreuen' → usage suffix becomes a note", () => {
    const out = parseIngredientLines(
      ["Etwas Puderzucker zum Bestreuen"],
      makeLookups(catalog),
    );
    expect(out[0].ingredientId).toBe(2);
    expect(out[0].name).toBe("Puderzucker");
    expect(out[0].notes).toContain("zum Bestreuen");
  });

  it("matched: 'salt- adjust to taste!' → clean notes, trailing '!' kept", () => {
    const out = parseIngredientLines(["salt- adjust to taste!"], makeLookups(catalog));
    expect(out[0].ingredientId).toBe(3);
    expect(out[0].name).toBe("salt");
    // "!"/"?" are meaningful sentence punctuation — kept verbatim in the note.
    expect(out[0].notes).toBe("adjust to taste!");
  });

  it("matched: 'Öl z.B. Olivenöl' → the earlier generic wins; example → notes", () => {
    const out = parseIngredientLines(["Öl z.B. Olivenöl"], makeLookups(catalog));
    expect(out[0].ingredientId).toBe(4);
    expect(out[0].name).toBe("Öl");
    expect(out[0].notes?.toLowerCase()).toContain("olivenöl");
  });

  it("unmatched: 'Sumac to taste' → proposal name without the phrase", () => {
    const out = parseIngredientLines(["Sumac to taste"], makeLookups(catalog));
    expect(out[0].ingredientMatch).toBe("new");
    expect(out[0].name).toBe("Sumac");
    expect(out[0].notes?.toLowerCase()).toContain("to taste");
  });

  it("unmatched: 'Wasabipulver zum Bestreuen' → usage tail never folds into the new name", () => {
    const out = parseIngredientLines(
      ["Wasabipulver zum Bestreuen"],
      makeLookups(catalog),
    );
    expect(out[0].ingredientMatch).toBe("new");
    expect(out[0].name).toBe("Wasabipulver");
    expect(out[0].notes).toContain("zum Bestreuen");
  });
});

describe("raw-remainder notes — matched lines keep the source verbatim", () => {
  // Flavor 1: only amount/unit/flags are consumed before matching; after a
  // match the notes are the verbatim source remainder before+after the
  // covered span (edges trimmed, whole-paren fragments unwrapped). No
  // category buckets, no mid-line peeling.
  const catalog: IngredientCatalog = [
    {
      ingredientId: 1,
      canonicalName: "cauliflower",
      aliasName: "cauliflower",
      tokens: ["cauliflower"],
    },
    {
      ingredientId: 2,
      canonicalName: "peanut butter",
      aliasName: "peanut butter",
      tokens: ["peanut", "butter"],
    },
    {
      ingredientId: 3,
      canonicalName: "unsalted butter",
      aliasName: "unsalted butter",
      tokens: ["unsalted", "butter"],
    },
    {
      ingredientId: 4,
      canonicalName: "Bohnen",
      aliasName: "Bohnen",
      tokens: ["bohnen"],
    },
    {
      ingredientId: 5,
      canonicalName: "Knoblauch",
      aliasName: "garlic",
      tokens: ["garlic"],
    },
  ];

  it("cauliflower: prep phrase survives intact, in source order", () => {
    const out = parseIngredientLines(
      ["1 small head cauliflower - sliced into 1-inch pieces, or small florets"],
      makeLookups(catalog),
    );
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].name).toBe("cauliflower");
    expect(out[0].quantity).toBe(1);
    // No unit stolen from "pieces" (interior numeric guard).
    expect(out[0].unit).toBeNull();
    // The prep phrase stays on the primary; "or small florets" is now a
    // proposed alternative row (the user deletes it to fold if undesired).
    expect(out[0].notes).toBe("small head, sliced into 1-inch pieces");
    expect(out[1].name).toBe("florets");
    expect(out[1].isAlternative).toBe(true);
  });

  it("a fragment ENTIRELY bound by parens is unwrapped", () => {
    const out = parseIngredientLines(
      ["500 g peanut butter (natural, no sugar added)"],
      makeLookups(catalog),
    );
    expect(out[0].ingredientId).toBe(2);
    expect(out[0].name).toBe("peanut butter");
    expect(out[0].notes).toBe("natural, no sugar added");
  });

  it("parens inside a larger fragment become comma separators", () => {
    const out = parseIngredientLines(
      ["500 g peanut butter (natural, no sugar added) smooth"],
      makeLookups(catalog),
    );
    expect(out[0].ingredientId).toBe(2);
    expect(out[0].notes).toBe("natural, no sugar added, smooth");
  });

  it("secondary measurement stays verbatim in the notes (no peel-gutting)", () => {
    const out = parseIngredientLines(
      ["1/2 cup 1 stick unsalted butter, room temperature"],
      makeLookups(catalog, ["cup", "stick"]),
    );
    expect(out[0].ingredientId).toBe(3);
    expect(out[0].quantity).toBe(0.5);
    expect(out[0].unit?.name.toLowerCase()).toBe("cup");
    expect(out[0].notes).toBe("1 stick, room temperature");
  });

  it("size modifier is skipped (not consumed) so the unit is still found", () => {
    const out = parseIngredientLines(
      ["1 kl. Dose Bohnen"],
      makeLookups(catalog, ["Dose"]),
    );
    expect(out[0].ingredientId).toBe(4);
    expect(out[0].quantity).toBe(1);
    expect(out[0].unit?.name).toBe("Dose");
    expect(out[0].notes).toBe("kl.");
  });

  it("trailing-unit fallback still fires for '1 garlic clove' and leaves the remainder", () => {
    const out = parseIngredientLines(
      ["1 garlic clove"],
      makeLookups(catalog, ["clove"]),
    );
    expect(out[0].ingredientId).toBe(5);
    expect(out[0].quantity).toBe(1);
    expect(out[0].unit?.name).toBe("clove");
    expect(out[0].notes).toBeNull();
  });
});

describe("paren content is matcher-invisible but stays verbatim in notes", () => {
  // Parens are a structural annotation marker (stronger than a comma). The
  // example product inside them must not steal the mapping from the generic
  // outside — "150 g Pilze (z. B. braune Champignons)" stays Pilze — but the
  // paren text remains in the notes verbatim (unwrapped when it is the whole
  // fragment).
  const catalog: IngredientCatalog = [
    { ingredientId: 1, canonicalName: "Pilze", aliasName: "Pilze", tokens: ["pilze"] },
    {
      ingredientId: 2,
      canonicalName: "brauner Champignon",
      aliasName: "braune Champignons",
      tokens: ["braune", "champignons"],
    },
  ];

  it("maps to the generic outside the parens", () => {
    const out = parseIngredientLines(
      ["150 g Pilze (z. B. braune Champignons)"],
      makeLookups(catalog),
    );
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].name).toBe("Pilze");
    expect(out[0].notes).toBe("z. B. braune Champignons");
  });
});

describe("front captures stay glued to the before-remainder", () => {
  // "5-6 große Äpfel": the range expression (consumed into the quantity) and
  // the size word are contiguous in the source — the note must read
  // "5-6 große", not "5-6, große".
  const catalog: IngredientCatalog = [
    { ingredientId: 1, canonicalName: "Apfel", aliasName: "Äpfel", tokens: ["apfel"] },
  ];

  it("'5-6 große Äpfel (am liebsten säuerlich)' keeps '5-6 große' intact", () => {
    const out = parseIngredientLines(
      ["5-6 große Äpfel (am liebsten säuerlich)"],
      makeLookups(catalog),
    );
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].quantity).toBe(6); // range resolves to the high bound
    expect(out[0].notes).toBe("5-6 große, am liebsten säuerlich");
  });
});

describe("preprocess size captures lead the notes", () => {
  // "12-count" / "(28 oz.)" are consumed alongside the amount at the line
  // FRONT — they must open the notes, not trail them.
  const catalog: IngredientCatalog = [
    {
      ingredientId: 1,
      canonicalName: "dinner roll",
      aliasName: "dinner rolls",
      tokens: ["dinner", "rolls"],
    },
  ];

  it("'1 12-count package … rolls, preferably whole-wheat' keeps 12-count first", () => {
    const out = parseIngredientLines(
      ["1 12-count package pull-apart dinner rolls, preferably whole-wheat"],
      makeLookups(catalog, ["package"]),
    );
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].unit?.name.toLowerCase()).toBe("package");
    expect(out[0].notes).toMatch(/^12-count/);
    expect(out[0].notes).toContain("whole-wheat");
    expect(out[0].notes).toContain("preferably whole");
  });
});

describe("sub / substitute / ersatzweise mark alternatives", () => {
  // "(sub X)", "(or sub X)", "(substitute with X)", "(ersatzweise X)" are
  // alternative markers like "(Alternativ: X)"; "or sub X" in a chain strips
  // the marker from the alternative's text. Same line-structure vocabulary
  // category as alternativ:/oder — never ingredient identity.
  const catalog: IngredientCatalog = [
    { ingredientId: 1, canonicalName: "honey", aliasName: "honey", tokens: ["honey"] },
    {
      ingredientId: 2,
      canonicalName: "maple syrup",
      aliasName: "maple syrup",
      tokens: ["maple", "syrup"],
    },
    {
      ingredientId: 3,
      canonicalName: "Schalotte",
      aliasName: "shallot",
      tokens: ["shallot"],
    },
    {
      ingredientId: 4,
      canonicalName: "rote Zwiebel",
      aliasName: "red onion",
      tokens: ["red", "onion"],
    },
    { ingredientId: 5, canonicalName: "Honig", aliasName: "Honig", tokens: ["honig"] },
    { ingredientId: 6, canonicalName: "Zucker", aliasName: "Zucker", tokens: ["zucker"] },
    {
      ingredientId: 7,
      canonicalName: "Joghurt",
      aliasName: "yogurt",
      tokens: ["yogurt"],
    },
    {
      ingredientId: 8,
      canonicalName: "Saure Sahne",
      aliasName: "sour cream",
      tokens: ["sour", "cream"],
    },
  ];

  it("'(sub maple syrup to make vegan)' adds an optional alternative with the tail as its note", () => {
    const out = parseIngredientLines(
      ["1/4 cup honey (sub maple syrup to make vegan)"],
      makeLookups(catalog, ["cup"]),
    );
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("honey");
    expect(out[0].isAlternative).toBe(false);
    expect(out[1].name).toBe("maple syrup");
    expect(out[1].isAlternative).toBe(true);
    expect(out[1].isOptional).toBe(true);
    expect(out[1].notes).toContain("to make vegan");
  });

  it("'(or sub 1/2 a red onion)' after a dash-annotated primary works too", () => {
    const out = parseIngredientLines(
      ["1 extra-large shallot - chopped (or sub 1/2 a red onion)"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(2);
    expect(out[0].ingredientId).toBe(3);
    expect(out[1].ingredientId).toBe(4);
    expect(out[1].isAlternative).toBe(true);
    expect(out[1].quantity).toBe(0.5);
  });

  it("'(ersatzweise Zucker)' is recognized as the German marker", () => {
    const out = parseIngredientLines(
      ["2 g Honig (ersatzweise Zucker)"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(2);
    expect(out[1].name).toBe("Zucker");
    expect(out[1].isAlternative).toBe(true);
  });

  it("chain form: 'or sub sour cream' strips the marker from the alternative", () => {
    const out = parseIngredientLines(
      ["1 cup yogurt or sub sour cream"],
      makeLookups(catalog, ["cup"]),
    );
    expect(out).toHaveLength(2);
    expect(out[0].ingredientId).toBe(7);
    expect(out[1].ingredientId).toBe(8);
    expect(out[1].name).toBe("sour cream");
    expect(out[1].isAlternative).toBe(true);
  });
});

describe("front-capture gluing follows source contiguity", () => {
  const catalog: IngredientCatalog = [
    { ingredientId: 1, canonicalName: "Zitrone", aliasName: "lemon", tokens: ["lemon"] },
    { ingredientId: 2, canonicalName: "Apfel", aliasName: "Äpfel", tokens: ["apfel"] },
  ];

  it("'Juice of 1 small lemon' → stripped words between pieces become a comma", () => {
    const out = parseIngredientLines(
      ["Juice of 1 small lemon"],
      makeLookups(catalog),
    );
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].quantity).toBe(1);
    expect(out[0].notes).toBe("Juice, small");
  });

  it("'5-6 große Äpfel' stays glued — nothing was stripped between range and word", () => {
    const out = parseIngredientLines(["5-6 große Äpfel"], makeLookups(catalog));
    expect(out[0].ingredientId).toBe(2);
    expect(out[0].notes).toBe("5-6 große");
  });
});

describe("paren sizes are front captures only at the line front", () => {
  const catalog: IngredientCatalog = [
    {
      ingredientId: 1,
      canonicalName: "Schalotte",
      aliasName: "shallots",
      tokens: ["shallots"],
    },
    {
      ingredientId: 2,
      canonicalName: "crushed tomatoes",
      aliasName: "crushed tomatoes",
      tokens: ["crushed", "tomatoes"],
    },
  ];

  it("'2 shallots (chopped (⅔ cup))' keeps source order in the notes", () => {
    const out = parseIngredientLines(
      ["2 shallots (chopped (⅔ cup))"],
      makeLookups(catalog, ["cup"]),
    );
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].quantity).toBe(2);
    // AST rule: only ROOT-level parens are unwrapped; the nested "(⅔ cup)" stays
    // verbatim (was "chopped, ⅔ cup" under the old unwrap-all behavior).
    expect(out[0].notes).toBe("chopped (⅔ cup)");
  });

  it("'1 (28 oz.) can crushed tomatoes' still leads with the size", () => {
    const out = parseIngredientLines(
      ["1 (28 oz.) can crushed tomatoes"],
      makeLookups(catalog, ["can"]),
    );
    expect(out[0].ingredientId).toBe(2);
    expect(out[0].unit?.name.toLowerCase()).toBe("can");
    expect(out[0].notes).toBe("28 oz.");
  });
});

describe("optional marker strip preserves the surrounding comma", () => {
  const catalog: IngredientCatalog = [
    {
      ingredientId: 1,
      canonicalName: "Chilischote",
      aliasName: "Chilischote",
      tokens: ["chilischote"],
    },
  ];

  it("'(gehackt, optional je nach Schärfe …)' keeps the comma where 'optional' was removed", () => {
    const out = parseIngredientLines(
      ["1 kleine Chilischote (gehackt, optional je nach Schärfe der Currypaste)"],
      makeLookups(catalog),
    );
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].isOptional).toBe(true);
    expect(out[0].notes).toBe("kleine, gehackt, je nach Schärfe der Currypaste");
  });
});

describe("a trailing note-only alternative is shared across the whole group", () => {
  const catalog: IngredientCatalog = [
    {
      ingredientId: 1,
      canonicalName: "Zitronensaft",
      aliasName: "Zitronensaft",
      tokens: ["zitronensaft"],
    },
    {
      ingredientId: 2,
      canonicalName: "Limettensaft",
      aliasName: "Limettensaft",
      tokens: ["limettensaft"],
    },
    {
      ingredientId: 3,
      canonicalName: "Kidneybohnen",
      aliasName: "Kidneybohnen",
      tokens: ["kidneybohnen"],
    },
    {
      ingredientId: 4,
      canonicalName: "Kichererbsen",
      aliasName: "Kichererbsen",
      tokens: ["kichererbsen"],
    },
  ];

  it("'(oder nach Geschmack)' applies to the primary AND the alternative", () => {
    const out = parseIngredientLines(
      ["2 EL Zitronensaft oder Limettensaft (oder nach Geschmack)"],
      makeLookups(catalog, ["EL"]),
    );
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("Zitronensaft");
    expect(out[0].isAlternative).toBe(false);
    expect(out[0].notes).toBe("oder nach Geschmack");
    expect(out[1].name).toBe("Limettensaft");
    expect(out[1].isAlternative).toBe(true);
    // The taste note is not a rejected ingredient alternative — it qualifies
    // the whole group, so the alternative carries it too.
    expect(out[1].notes).toBe("oder nach Geschmack");
  });

  it("an unmatched INGREDIENT alternative is proposed as its own row", () => {
    const out = parseIngredientLines(
      ["100 g Kidneybohnen oder Kichererbsen (oder schwarze Bohnen)"],
      makeLookups(catalog),
    );
    // "schwarze Bohnen" is a real (just unmatched) ingredient — it is now
    // proposed as its own alternative row rather than folded into the note.
    expect(out).toHaveLength(3);
    expect(out[0].name).toBe("Kidneybohnen");
    expect(out[0].notes).toBeNull();
    expect(out[1].name).toBe("Kichererbsen");
    expect(out[1].isAlternative).toBe(true);
    expect(out[2].name).toBe("schwarze Bohnen");
    expect(out[2].isAlternative).toBe(true);
    expect(out[2].ingredientMatch).toBe("new");
  });
});
