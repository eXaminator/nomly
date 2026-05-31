import { describe, expect, it } from "vitest";
import {
  buildReparsedRecipeInput,
  carriedAlternatives,
  groupContiguousByRawLine,
  isLineGroupChanged,
  type CurrentRow,
} from "@/lib/recipes/reparse-scan";
import type { ParsedIngredientResponse } from "@/components/recipes/types";
import type { RecipeIngredientInput, RecipeView } from "@/lib/recipes/types";

function viewRow(over: Record<string, unknown> = {}) {
  return {
    id: 100,
    ingredientId: 5,
    ingredientName: "Salz",
    canonicalIngredientName: null,
    quantity: 1,
    unitId: 2,
    unitName: "g",
    notes: null,
    isOptional: false,
    fixedAmount: false,
    rawLine: "1 g Salz",
    isEquipment: false,
    dietaryClass: null,
    sortOrder: 0,
    alternativeForId: null,
    ...over,
  };
}
function viewWith(ingredients: ReturnType<typeof viewRow>[]): RecipeView {
  return {
    id: 1,
    title: "R",
    description: null,
    photoPath: null,
    sourceUrl: null,
    servings: 2,
    prepTimeMin: null,
    cookTimeMin: null,
    tags: [],
    isVegan: null,
    isVegetarian: null,
    dietConfidence: "low",
    needsUpdate: false,
    createdAt: 0,
    updatedAt: 0,
    sections: [
      { id: 9, title: null, instructions: "", sortOrder: 0, ingredients },
    ],
  } as unknown as RecipeView;
}
function newRow(over: Partial<RecipeIngredientInput> = {}): RecipeIngredientInput {
  return {
    ingredientName: "Meersalz",
    ingredientId: 5,
    quantity: 2,
    unitId: 2,
    displayUnit: null,
    notes: "grob",
    isOptional: false,
    fixedAmount: false,
    rawLine: "1 g Salz",
    isAlternative: false,
    ...over,
  };
}

function cur(over: Partial<CurrentRow> = {}): CurrentRow {
  return {
    id: 1,
    ingredientId: 5,
    name: "Tomate",
    quantity: 2,
    unitId: 3,
    notes: null,
    isOptional: false,
    alternativeForId: null,
    ...over,
  };
}

function prop(over: Partial<ParsedIngredientResponse> = {}): ParsedIngredientResponse {
  return {
    quantity: 2,
    unit: { id: 3, name: "g" },
    unitMatch: "matched",
    rawUnit: null,
    name: "Tomate",
    ingredientId: 5,
    ingredientMatch: "existing",
    canonicalIngredientName: null,
    notes: null,
    isOptional: false,
    fixedAmount: false,
    isAlternative: false,
    rawText: "2 g Tomate",
    candidateMatches: [],
    ...over,
  };
}

describe("isLineGroupChanged", () => {
  it("false when identical", () => {
    expect(isLineGroupChanged([cur()], [prop()])).toBe(false);
  });
  it("true when ingredient mapping differs", () => {
    expect(isLineGroupChanged([cur({ ingredientId: 5 })], [prop({ ingredientId: 9 })])).toBe(true);
  });
  it("true when mapped vs new (null) differs", () => {
    expect(isLineGroupChanged([cur({ ingredientId: 5 })], [prop({ ingredientId: null })])).toBe(true);
  });
  it("true when name differs", () => {
    expect(isLineGroupChanged([cur({ name: "Tomate" })], [prop({ name: "Tomaten" })])).toBe(true);
  });
  it("treats null and empty notes as equal", () => {
    expect(isLineGroupChanged([cur({ notes: null })], [prop({ notes: "" })])).toBe(false);
  });
  it("true when notes differ", () => {
    expect(isLineGroupChanged([cur({ notes: "fein" })], [prop({ notes: "grob" })])).toBe(true);
  });
  it("true when quantity differs, false within epsilon", () => {
    expect(isLineGroupChanged([cur({ quantity: 2 })], [prop({ quantity: 3 })])).toBe(true);
    expect(isLineGroupChanged([cur({ quantity: 2 })], [prop({ quantity: 2.0000001 })])).toBe(false);
  });
  it("true when unit differs", () => {
    expect(
      isLineGroupChanged([cur({ unitId: 3 })], [prop({ unit: { id: 4, name: "ml" } })]),
    ).toBe(true);
  });
  it("true when the unit changes to a (promoted count) unit", () => {
    expect(
      isLineGroupChanged(
        [cur({ unitId: 3 })],
        [prop({ unit: { id: 7, name: "Zehe" } })],
      ),
    ).toBe(true);
  });
  it("true when optional / alternative flags differ", () => {
    expect(isLineGroupChanged([cur({ isOptional: false })], [prop({ isOptional: true })])).toBe(true);
    expect(isLineGroupChanged([cur({ alternativeForId: null })], [prop({ isAlternative: true })])).toBe(true);
  });
  it("true when row counts differ", () => {
    expect(isLineGroupChanged([cur()], [prop(), prop({ name: "Margarine" })])).toBe(true);
  });
});

describe("groupContiguousByRawLine", () => {
  it("groups contiguous same-rawLine rows within a section, skips empty rawLine", () => {
    const rows = [
      { sectionId: 1, id: 10, rawLine: "a" },
      { sectionId: 1, id: 11, rawLine: "a" },
      { sectionId: 1, id: 12, rawLine: "" },
      { sectionId: 1, id: 13, rawLine: "b" },
      { sectionId: 2, id: 14, rawLine: "a" },
    ];
    const groups = groupContiguousByRawLine(rows);
    expect(groups.map((g) => g.map((r) => r.id))).toEqual([[10, 11], [13], [14]]);
  });

  it("absorbs a manually-added alternative (empty rawLine, alternativeForId) into its primary's group", () => {
    const rows = [
      { sectionId: 1, id: 10, rawLine: "100 ml Gemüsebrühe", alternativeForId: null },
      // Manually-added alternative of row 10: no source line, links to 10.
      { sectionId: 1, id: 11, rawLine: "", alternativeForId: 10 },
      { sectionId: 1, id: 12, rawLine: "1 g Salz", alternativeForId: null },
    ];
    const groups = groupContiguousByRawLine(rows);
    expect(groups.map((g) => g.map((r) => r.id))).toEqual([[10, 11], [12]]);
  });

  it("drops an empty-rawLine row that is NOT an alternative", () => {
    const rows = [
      { sectionId: 1, id: 10, rawLine: "a", alternativeForId: null },
      { sectionId: 1, id: 11, rawLine: "", alternativeForId: null },
    ];
    expect(groupContiguousByRawLine(rows).map((g) => g.map((r) => r.id))).toEqual([
      [10],
    ]);
  });
});

describe("carriedAlternatives", () => {
  const L = "50 ml Kokosmilch (oder Hafer- oder Sojabasis)";
  function row(over: Partial<{ id: number; rawLine: string | null; alternativeForId: number | null; ingredientId: number | null }>) {
    return { id: 0, rawLine: L, alternativeForId: null, ingredientId: null, ...over };
  }

  it("carries an in-source alternative the re-parse no longer produces (surplus)", () => {
    // group = [primary(rawL), Hafercuisine(rawL alt), Sojacuisine(manual alt)]
    const group = [
      row({ id: 1, ingredientId: 596 }),
      row({ id: 2, ingredientId: 177, alternativeForId: 1 }),
      row({ id: 3, rawLine: "", ingredientId: 202, alternativeForId: 1 }),
    ];
    // Re-parse yields only the primary → both alternatives are carried.
    const carried = carriedAlternatives(group, 1, new Set([596]));
    expect(carried.map((g) => g.id)).toEqual([2, 3]);
  });

  it("does NOT carry an in-source alternative the parser still produces (lets it re-map)", () => {
    const group = [
      row({ id: 1, ingredientId: 596 }),
      row({ id: 2, ingredientId: 5, alternativeForId: 1 }),
    ];
    // Re-parse produced 2 rows (primary + the alternative, possibly re-mapped).
    // Nothing is carried — the parser's row replaces it, no duplicate.
    expect(carriedAlternatives(group, 2, new Set([596, 8]))).toEqual([]);
  });

  it("drops a manual alternative the parser now produces itself (no duplicate)", () => {
    const group = [
      row({ id: 1, ingredientId: 1 }),
      row({ id: 2, rawLine: "", ingredientId: 9, alternativeForId: 1 }),
    ];
    // Parser now splits the chain and produces ingredient 9 itself.
    expect(carriedAlternatives(group, 2, new Set([1, 9]))).toEqual([]);
  });

  it("keeps a manual alternative whose ingredient the parser does not produce", () => {
    const group = [
      row({ id: 1, ingredientId: 1 }),
      row({ id: 2, rawLine: "", ingredientId: 42, alternativeForId: 1 }),
    ];
    expect(carriedAlternatives(group, 1, new Set([1])).map((g) => g.id)).toEqual([2]);
  });

  it("never carries the primary", () => {
    const group = [row({ id: 1, ingredientId: 596 })];
    expect(carriedAlternatives(group, 0, new Set())).toEqual([]);
  });
});

describe("buildReparsedRecipeInput", () => {
  it("substitutes a group, preserves order + other rows + rawLine", () => {
    const view = viewWith([
      viewRow({ id: 100, ingredientName: "Salz", ingredientId: 5, sortOrder: 0 }),
      viewRow({ id: 101, ingredientName: "Pfeffer", ingredientId: 6, sortOrder: 1, rawLine: "1 g Pfeffer" }),
    ]);
    const { input, appliedGroups, skipped } = buildReparsedRecipeInput(view, [
      { replaceRowIds: [100], rows: [newRow({ ingredientName: "Meersalz", notes: "grob" })] },
    ]);
    expect(appliedGroups).toBe(1);
    expect(skipped).toBe(0);
    expect(input.sections[0].ingredients.map((x) => x.ingredientName)).toEqual([
      "Meersalz",
      "Pfeffer",
    ]);
    expect(input.sections[0].ingredients[0].notes).toBe("grob");
    expect(input.sections[0].ingredients[1].rawLine).toBe("1 g Pfeffer");
  });

  it("replaces a multi-row group with however many new rows", () => {
    const view = viewWith([
      viewRow({ id: 100, ingredientName: "Butter", rawLine: "Butter oder Margarine", sortOrder: 0 }),
      viewRow({ id: 101, ingredientName: "Margarine", rawLine: "Butter oder Margarine", sortOrder: 1, alternativeForId: 100 }),
      viewRow({ id: 102, ingredientName: "Mehl", rawLine: "Mehl", sortOrder: 2 }),
    ]);
    const { input, appliedGroups } = buildReparsedRecipeInput(view, [
      { replaceRowIds: [100, 101], rows: [newRow({ ingredientName: "Butter", notes: null })] },
    ]);
    expect(appliedGroups).toBe(1);
    expect(input.sections[0].ingredients.map((x) => x.ingredientName)).toEqual([
      "Butter",
      "Mehl",
    ]);
  });

  it("counts a replacement with absent ids as skipped, leaves rows intact", () => {
    const view = viewWith([
      viewRow({ id: 100, ingredientName: "Salz", sortOrder: 0 }),
    ]);
    const { input, appliedGroups, skipped } = buildReparsedRecipeInput(view, [
      { replaceRowIds: [999], rows: [newRow()] },
    ]);
    expect(appliedGroups).toBe(0);
    expect(skipped).toBe(1);
    expect(input.sections[0].ingredients.map((x) => x.ingredientName)).toEqual(["Salz"]);
  });
})
