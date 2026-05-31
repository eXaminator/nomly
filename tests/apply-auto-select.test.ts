import { describe, expect, it } from "vitest";
import {
  applyAutoSelect,
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
  // selection. A later match response must NOT silently re-bind the row to a
  // candidate — otherwise it stops counting as a new ingredient on save and
  // the new-ingredient enrichment dialog never opens.
  const neu = {
    ...emptyIngredient(),
    name: "Mehl",
    selectedIngredientId: null,
    pinnedByUser: true,
  };

  it("stays 'Neu' even when an above-threshold candidate exists", () => {
    const out = applyAutoSelect(neu, "Mehl", [match()]);
    expect(out.selectedIngredientId).toBeNull();
  });

  it("stays 'Neu' even when a candidate matches the typed name exactly", () => {
    const out = applyAutoSelect(neu, "Mehl", [
      match({ canonicalName: "Mehl", matchedName: "Mehl" }),
    ]);
    expect(out.selectedIngredientId).toBeNull();
  });

  it("an UNPINNED row still auto-matches an above-threshold candidate", () => {
    const unpinned = { ...neu, pinnedByUser: false };
    const out = applyAutoSelect(unpinned, "Mehl", [match({ ingredientId: 7 })]);
    expect(out.selectedIngredientId).toBe(7);
  });
});
