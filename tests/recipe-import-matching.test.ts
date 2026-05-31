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
  type IngredientLookup,
  type ParseLookups,
  type UnitLookup,
} from "@/lib/recipe-import";
import type { IngredientCatalog } from "@/lib/recipe-import/matching";

function makeLookups(
  catalog: IngredientCatalog,
  extraUnits: readonly string[] = [],
  nounUnitFormsById: Map<number, string[]> = new Map(),
): ParseLookups {
  const unitEntries = ["g", ...extraUnits].map((name, i) => [
    name.toLowerCase(),
    { id: i + 1, name, isContainer: false },
  ] as const);
  const units: UnitLookup = {
    byNameOrAlias: new Map(unitEntries),
    byCanonicalName: new Map(unitEntries),
    containerTokens: new Set(),
    nounUnitFormsById,
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

  it("'oder' does NOT split when pre-separator ends with a dash (compound stem like 'Weizen- oder Dinkelmehl')", () => {
    const out = parseIngredientLines(
      ["200 g Weizen- oder Dinkelmehl"],
      makeLookups([]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].name.toLowerCase()).toMatch(/weizen.*dinkelmehl|weizenmehl/);
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

describe("parseIngredientLines — unmatched alternative fold-back", () => {
  it("folds an unmatched 'oder' alternative back into the primary's notes", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Mehl", aliasName: "Mehl", tokens: ["mehl"] },
    ];
    const out = parseIngredientLines(
      ["200 g Mehl oder Stärke"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].name).toBe("Mehl");
    expect(out[0].notes).toMatch(/oder Stärke/);
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

  it("preserves the English 'or' as the connector when folding", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Butter", aliasName: "Butter", tokens: ["butter"] },
    ];
    const out = parseIngredientLines(
      ["100 g Butter or Margarine"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].notes).toMatch(/or Margarine/);
    expect(out[0].notes).not.toMatch(/oder/);
  });

  it("preserves the alternative's quantity in the folded note", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Mehl", aliasName: "Mehl", tokens: ["mehl"] },
    ];
    const out = parseIngredientLines(
      ["200 g Mehl oder 100 g Stärke"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].notes).toMatch(/oder.*100\s*g\s*Stärke/);
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

  it("folds an unmatched 'alternativ:' tail back into the primary's notes", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Tahin", aliasName: "Tahin", tokens: ["tahin"] },
    ];
    const out = parseIngredientLines(
      ["1 EL Tahin alternativ: 1 EL Mandelmus"],
      makeLookups(catalog, ["el"]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].notes).toMatch(/alternativ.*Mandelmus/i);
  });

  it("folds an unmatched '(Alternativ: …)' tail back into the primary's notes", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Mehl", aliasName: "Mehl", tokens: ["mehl"] },
    ];
    const out = parseIngredientLines(
      ["200 g Mehl (Alternativ: Stärke)"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].notes).toMatch(/Alternativ.*Stärke/i);
  });

  it("scopes the fold-back to the current input line (no leak across lines)", () => {
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
    expect(out).toHaveLength(2);
    expect(out[0].ingredientId).toBe(1);
    expect(out[0].notes).toBeNull();
    expect(out[1].ingredientId).toBe(2);
    expect(out[1].notes).toMatch(/oder Margarine/);
  });

  it("section variant: folds an unmatched alternative within its section", () => {
    const catalog: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Mehl", aliasName: "Mehl", tokens: ["mehl"] },
    ];
    const groups = parseIngredientLinesIntoSections(
      ["200 g Mehl oder Stärke"],
      makeLookups(catalog),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].ingredients).toHaveLength(1);
    expect(groups[0].ingredients[0].ingredientId).toBe(1);
    expect(groups[0].ingredients[0].notes).toMatch(/oder Stärke/);
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
    expect(out[0].notes).toBe("2-3, for frying");
  });

  it("size, paren amount, then comma-tail prep — all comma-separated, in order (new ingredient)", () => {
    const out = parseIngredientLines(
      ["1/2 pound (225g) large shrimp, peeled and deveined"],
      makeLookups([], ["pound"]),
    );
    expect(out[0].ingredientMatch).toBe("new");
    expect(out[0].name).toBe("shrimp");
    expect(out[0].notes).toBe("225 g, large, peeled and deveined");
  });

  it("noun-unit compound alias: '3 Knoblauchzehen' → 3 Zehe Knoblauch (strips the unit-noun)", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 5,
        canonicalName: "Knoblauch",
        aliasName: "Knoblauchzehen",
        tokens: ["knoblauchzehen"],
        defaultUnit: { id: 99, name: "Zehe" },
      },
    ];
    // Unit 99 ("Zehe") is a noun unit with forms zehen/zehe.
    const nounForms = new Map([[99, ["zehen", "zehe"]]]);
    const out = parseIngredientLines(
      ["3 Knoblauchzehen"],
      makeLookups(catalog, [], nounForms),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(5);
    expect(out[0].quantity).toBe(3);
    expect(out[0].unit?.id).toBe(99);
    // The redundant "zehen" is stripped from the alias → "Knoblauch".
    expect(out[0].name).toBe("Knoblauch");
    expect(out[0].canonicalIngredientName).toBeNull();
  });

  it("strips the unit-noun in the alias's own language (English alias stays English)", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 5,
        canonicalName: "Knoblauch",
        aliasName: "garlic cloves",
        tokens: ["garlic", "cloves"],
        defaultUnit: { id: 99, name: "Zehe" },
      },
    ];
    // Zehe's English alias forms are part of its surface set.
    const nounForms = new Map([[99, ["cloves", "clove", "zehen", "zehe"]]]);
    // No quantity → no trailing-unit detection; the alias default drives it.
    const out = parseIngredientLines(
      ["garlic cloves"],
      makeLookups(catalog, [], nounForms),
    );
    expect(out[0].ingredientId).toBe(5);
    // English alias minus "cloves" → "garlic" (NOT the German canonical).
    expect(out[0].name).toBe("garlic");
    expect(out[0].canonicalIngredientName).toBe("Knoblauch");
  });

  it("a descriptor alias with a non-noun default unit keeps its full name", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 7,
        canonicalName: "Olivenöl",
        aliasName: "Olivenöl extra virgin",
        tokens: ["olivenol", "extra", "virgin"],
        defaultUnit: { id: 3, name: "ml" },
      },
    ];
    // ml is NOT a noun unit → no forms → nothing stripped.
    const out = parseIngredientLines(
      ["Olivenöl extra virgin"],
      makeLookups(catalog),
    );
    expect(out[0].ingredientId).toBe(7);
    expect(out[0].name).toBe("Olivenöl extra virgin");
  });
});
