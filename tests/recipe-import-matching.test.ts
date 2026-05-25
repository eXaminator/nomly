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
  type SubUnitLookup,
  type UnitLookup,
} from "@/lib/recipe-import";
import type { IngredientCatalog } from "@/lib/recipe-import/matching";

function makeLookups(catalog: IngredientCatalog): ParseLookups {
  const units: UnitLookup = {
    byNameOrAlias: new Map([["g", { id: 1, name: "g", isContainer: false }]]),
    byCanonicalName: new Map([["g", { id: 1, name: "g", isContainer: false }]]),
    containerTokens: new Set(),
  };
  const ingredients: IngredientLookup = new Map();
  for (const entry of catalog) {
    ingredients.set(entry.aliasName.toLowerCase(), {
      id: entry.ingredientId,
      canonicalName: entry.canonicalName,
    });
  }
  const subUnits: SubUnitLookup = new Map();
  return { units, ingredients, ingredientCatalog: catalog, subUnits };
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
    // The matcher consumed both the head ("Paprikapulver") and the
    // comma-tail ("rosenscharfes" matched the "rosenscharf" entry token
    // by close-inflection prefix), so the comma-tail content is IDENTITY,
    // not annotation — fold it back into displayName.
    expect(out[0].name).toBe("Paprikapulver, rosenscharfes");
    expect(out[0].ingredientMatch).toBe("existing");
    // Comma-tail was fully consumed by the match → no leftover in notes.
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
    // After displayName preservation: the row keeps the user's spelling
    // (`Paprikaschoten`) while `ingredientId` still points at the singular
    // canonical for shopping-list merging. The canonical surfaces as
    // `canonicalIngredientName`.
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
    expect(out[0].name).toBe("Paprikaschoten");
    expect(out[0].canonicalIngredientName).toBe("Paprikaschote");
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

  it("exposes uncoveredText on candidate matches so the pill UI can move tokens to notes", () => {
    // A wide-text match that didn't auto-pick still surfaces as a pill. The
    // matcher reports which raw candidate tokens the entry did NOT cover so
    // the pill UI can move them out of the name and into the notes field
    // when the user picks the pill manually.
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
    // "knoblauch" matches "knoblauchzehe" as a prefix-fragment, so the
    // covered token is "Knoblauchzehe" itself; "rote" stays uncovered.
    expect(knoblauchCandidate?.uncoveredText).toBe("rote");
  });

  it("merges a German plural inflection in the reverse direction (Paprikaschote → catalog Paprikaschoten)", () => {
    // The catalog happens to hold the plural form (whichever recipe got
    // imported first); a later recipe with the singular should still merge,
    // and the singular's spelling wins in the row's displayName.
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
    expect(out[0].name).toBe("Paprikaschote");
    expect(out[0].canonicalIngredientName).toBe("Paprikaschoten");
    expect(out[0].ingredientMatch).toBe("existing");
  });

  it("auto-resolves 'Paprika-Pulver' to catalog 'Paprikapulver' over catalog 'Paprika'", () => {
    // The dash tokenises into ["paprika", "pulver"] under the primary
    // tokenisation — Paprika would win on a 1-token exact hit. The joined
    // variant gives Paprikapulver an equal 135 plus the alias-length
    // tiebreak, so the parser picks Paprikapulver. After displayName
    // preservation, the row keeps the user's "Paprika-Pulver" spelling and
    // surfaces the canonical separately.
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
    expect(out[0].name).toBe("Paprika-Pulver");
    expect(out[0].canonicalIngredientName).toBe("Paprikapulver");
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
    // displayName preservation: the row keeps the plural the user typed,
    // canonical surfaces separately.
    expect(secondOut[0].name).toBe("Paprikaschoten");
    expect(secondOut[0].canonicalIngredientName).toBe("Paprikaschote");
  });

  it("does NOT merge 'Paprikapulver edelsüß' (no comma) into bare 'Paprikapulver'", () => {
    // Regression: Phase A preserved the user's text as displayName. The
    // wide-text matcher was still happily linking "Paprikapulver edelsüß"
    // to catalog "Paprikapulver" via 1-token-fragment-at-start (score 135
    // before the anchor-coverage fix). The fix requires the entry to
    // cover the full candidate before the anchor +5 fires.
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
    expect(out[0].ingredientId).toBeNull();
    expect(out[0].ingredientMatch).toBe("new");
    expect(out[0].name).toBe("Paprikapulver edelsüß");
    // Paprikapulver is still surfaced as a candidate the user can opt into
    // via the pill UI.
    expect(
      out[0].candidateMatches.some((c) => c.canonicalName === "Paprikapulver"),
    ).toBe(true);
  });

  it("treats 'Paprikapulver, edelsüß' (with comma) the same way as the no-comma form", () => {
    // Companion to the above: the comma marks "edelsüß" as a qualifier,
    // but since it's not a prep-like word the resolver folds it back into
    // the new ingredient's name so both forms create the same canonical.
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
    expect(out[0].ingredientId).toBeNull();
    expect(out[0].ingredientMatch).toBe("new");
    expect(out[0].name).toBe("Paprikapulver edelsüß");
  });

  it("URL-import shape: verbatim chefkoch '2 EL Erbsen, TK' line resolves to a new 'TK Erbsen' row", () => {
    // The exact line from
    //   https://www.chefkoch.de/rezepte/1984961321880189/Spaghetti-Frank-Sinatra.html
    // — Erbsen exists in the catalog, but partial-coverage scoring (130)
    // keeps it below the auto-merge gate. The row should land as a new
    // ingredient "TK Erbsen", not as a row linked to bare Erbsen.
    const catalog: IngredientCatalog = [
      {
        ingredientId: 5,
        canonicalName: "Erbsen",
        aliasName: "Erbsen",
        tokens: ["erbsen"],
      },
    ];
    const out = parseIngredientLines(
      // The chefkoch source has "2 EL …" — the test fixture's `makeLookups`
      // only carries "g" as a unit, so we substitute it. The matcher /
      // resolver behaviour under test is unit-agnostic.
      ["2 g Erbsen, TK"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("TK Erbsen");
    expect(out[0].ingredientId).toBeNull();
    expect(out[0].ingredientMatch).toBe("new");
    // Erbsen still appears as a candidate pill so the user can opt in.
    expect(
      out[0].candidateMatches.some((c) => c.canonicalName === "Erbsen"),
    ).toBe(true);
    // The cleanup proposal that puts edelsüß-style modifiers AFTER the
    // noun would have produced "Erbsen TK"; the prefix-placement rule
    // catches the short uppercase abbreviation and flips it.
    expect(
      out[0].newNameProposals.find((p) => p.label === "Aufgeräumt")?.name,
    ).toBe("TK Erbsen");
  });

  it("folds a short uppercase comma-tail as a PREFIX (e.g. 'Erbsen, TK' → 'TK Erbsen')", () => {
    // German recipes use "TK" (Tiefkühl = frozen) as an identity marker
    // that conventionally goes IN FRONT of the noun. When the user writes
    // it comma-separated, the resolver still folds it back into the new
    // ingredient name — but as a prefix, not a suffix.
    const catalog: IngredientCatalog = [
      {
        ingredientId: 7,
        canonicalName: "Erbsen",
        aliasName: "Erbsen",
        tokens: ["erbsen"],
      },
    ];
    const out = parseIngredientLines(
      ["2 g Erbsen, TK"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBeNull();
    expect(out[0].ingredientMatch).toBe("new");
    expect(out[0].name).toBe("TK Erbsen");
    // Erbsen is still surfaced as a pill candidate so the user can opt in.
    expect(
      out[0].candidateMatches.some((c) => c.canonicalName === "Erbsen"),
    ).toBe(true);
  });

  it("folds the comma-tail back into displayName when the match consumes it ('Erbsen, TK' → 'Erbsen, TK' with TK Erbsen id)", () => {
    // The catalog has the canonical "TK Erbsen". The matcher consumes
    // BOTH "erbsen" (from the head) and "tk" (from the comma-tail), so the
    // tail is identity — preserve the user's original comma form.
    const catalog: IngredientCatalog = [
      {
        ingredientId: 42,
        canonicalName: "TK Erbsen",
        aliasName: "TK Erbsen",
        tokens: ["tk", "erbsen"],
      },
    ];
    const out = parseIngredientLines(
      ["2 g Erbsen, TK"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe(42);
    expect(out[0].name).toBe("Erbsen, TK");
    // Canonical differs from the displayed text → surface it for the
    // import-review UI's "kanonisch: …" pill.
    expect(out[0].canonicalIngredientName).toBe("TK Erbsen");
    // Comma-tail fully consumed → notes should be empty.
    expect(out[0].notes).toBeNull();
  });

  it("delegates the unmatched comma-tail tokens to notes ('Erbsen, TK, saftig' → name 'Erbsen, TK' + notes 'saftig')", () => {
    // Partial-match case: "TK" is consumed by the catalog entry, but
    // "saftig" stays as a user note. The displayName fold is space-joined
    // (no comma) and the leftover comma-tail token survives in notes.
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
    // Only "TK" was in the parser's commaTail (the second comma ends the
    // run), so the fold consumes the whole commaTail substring — the
    // displayName picks up the user's original comma form.
    expect(out[0].name).toBe("Erbsen, TK");
    expect(out[0].notes).toMatch(/saftig/);
  });

  it("still merges 'Tomaten, klein gehackt' to Tomate (commaTail is all prep-like)", () => {
    // Counterpoint: when the comma-tail content is ALL prep-like
    // ("klein" is SIZE_MODIFIER, "gehackt" is PREP_LEADING_TOKEN), the
    // cleanup-rematch path still fires and the row links to the broader
    // canonical. The displayName is the pre-comma identity and the
    // qualifier lands in notes — same shape as before this fix.
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
    expect(out[0].name).toBe("Tomaten");
    expect(out[0].notes).toMatch(/klein gehackt/);
  });

  it("creates a new ingredient when nothing clears the threshold", () => {
    const catalog: IngredientCatalog = [
      {
        ingredientId: 3,
        canonicalName: "Tomate",
        aliasName: "Tomate",
        tokens: ["tomate"],
      },
    ];
    const out = parseIngredientLines(
      ["3 g Cherry-Tomate"],
      makeLookups(catalog),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBeNull();
    expect(out[0].ingredientMatch).toBe("new");
    expect(out[0].newNameProposals.length).toBeGreaterThan(0);
    // The weak Tomate match is still surfaced via candidateMatches so the
    // user can opt in via the pill UI.
    expect(out[0].candidateMatches.some((c) => c.canonicalName === "Tomate")).toBe(true);
  });
});

describe("colon-in-name treated as undetected section header", () => {
  it("skips colon-bearing rows in parseIngredientLines (flat variant)", () => {
    // "Topping: cheese" parses to name="Topping: cheese" (colon kept) —
    // catalog-pollution risk if it became an ingredient. The flat
    // variant just drops the row.
    const out = parseIngredientLines(
      ["1 g Mehl", "Topping: cheese", "2 g Zucker"],
      makeLookups([]),
    );
    expect(out).toHaveLength(2);
    expect(out.map((i) => i.name)).toEqual(["Mehl", "Zucker"]);
  });

  it("promotes colon-bearing rows to a new section in parseIngredientLinesIntoSections", () => {
    const out = parseIngredientLinesIntoSections(
      ["1 g Mehl", "Topping: cheese", "2 g Zucker"],
      makeLookups([]),
    );
    // First group: leading ingredients before any header.
    expect(out[0]).toMatchObject({
      title: null,
      ingredients: expect.arrayContaining([expect.objectContaining({ name: "Mehl" })]),
    });
    // Second group: section "Topping" picked up from the colon line.
    expect(out[1].title).toBe("Topping");
    // Zucker lands in the new section (no further header in between).
    expect(out[1].ingredients.map((i) => i.name)).toEqual(["Zucker"]);
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
