import { describe, expect, it } from "vitest";
import {
  applyAutoSelect,
  findExactMatch,
  type ServerMatch,
} from "@/components/recipes/ingredient-row";
import { emptyIngredient } from "@/components/recipes/types";
import { MIN_AUTO_MATCH_SCORE } from "@/lib/recipe-import/matching";

function match(over: Partial<ServerMatch> = {}): ServerMatch {
  return {
    ingredientId: 1,
    canonicalName: "Mehl",
    matchedName: "Mehl",
    score: MIN_AUTO_MATCH_SCORE + 10,
    name: "Mehl",
    notes: null,
    isEquipment: false,
    ...over,
  };
}

describe("applyAutoSelect — deliberate 'Neu' pin", () => {
  // The user clicked the synthetic "Neu" pill: pinnedByUser=true with a null
  // selection. A later FUZZY match response must NOT silently re-bind the row
  // to a candidate — otherwise it stops counting as a new ingredient on save
  // and the new-ingredient enrichment dialog never opens.
  const neu = {
    ...emptyIngredient(),
    name: "Mehl",
    selectedIngredientId: null,
    pinnedByUser: true,
  };

  it("stays 'Neu' for a NON-exact above-threshold candidate", () => {
    const out = applyAutoSelect({ ...neu, name: "Mehl Type 405" }, "Mehl Type 405", [
      match({ canonicalName: "Mehl", matchedName: "Mehl" }),
    ]);
    expect(out.selectedIngredientId).toBeNull();
  });

  // An EXACT name/alias collision is special: a new ingredient with that name
  // is impossible (ingredient.name is unique) and the recipe-save resolver
  // would silently link to the existing one regardless of the pin. So an exact
  // collision overrides the "Neu" pin and binds the existing match — mirroring
  // the disabled "Neu" pill in the UI.
  it("yields to an EXACT canonical match — a duplicate name can't be created", () => {
    const out = applyAutoSelect(neu, "Mehl", [
      match({ ingredientId: 5, canonicalName: "Mehl", matchedName: "Mehl" }),
    ]);
    expect(out.selectedIngredientId).toBe(5);
    expect(out.pinnedByUser).toBe(false);
  });

  it("yields to an EXACT alias match too", () => {
    const out = applyAutoSelect({ ...neu, name: "Weizenmehl" }, "Weizenmehl", [
      match({ ingredientId: 9, canonicalName: "Mehl", matchedName: "Weizenmehl" }),
    ]);
    expect(out.selectedIngredientId).toBe(9);
    expect(out.pinnedByUser).toBe(false);
  });

  it("an UNPINNED row still auto-matches an above-threshold candidate", () => {
    const unpinned = { ...neu, pinnedByUser: false };
    const out = applyAutoSelect(unpinned, "Mehl", [match({ ingredientId: 7 })]);
    expect(out.selectedIngredientId).toBe(7);
  });
});

describe("findExactMatch", () => {
  it("matches a canonical name case-insensitively", () => {
    expect(findExactMatch("mehl", [match({ canonicalName: "Mehl" })])).toBeTruthy();
  });

  it("matches an alias the matcher hit on", () => {
    expect(
      findExactMatch("Weizenmehl", [
        match({ canonicalName: "Mehl", matchedName: "Weizenmehl" }),
      ]),
    ).toBeTruthy();
  });

  it("ignores non-exact (fuzzy) candidates", () => {
    expect(
      findExactMatch("Mehl Type 405", [
        match({ canonicalName: "Mehl", matchedName: "Mehl" }),
      ]),
    ).toBeUndefined();
  });

  it("returns undefined for an empty/whitespace name", () => {
    expect(findExactMatch("   ", [match()])).toBeUndefined();
  });
});
