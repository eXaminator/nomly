import { describe, expect, it } from "vitest";
import {
  groupContiguousByRawLine,
  isLineGroupChanged,
  type CurrentRow,
} from "@/lib/recipes/reparse-scan";
import type { ParsedIngredientResponse } from "@/components/recipes/types";

function cur(over: Partial<CurrentRow> = {}): CurrentRow {
  return {
    id: 1,
    ingredientId: 5,
    name: "Tomate",
    quantity: 2,
    unitId: 3,
    subUnitId: null,
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
    subUnit: null,
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
      isLineGroupChanged([cur({ unitId: 3, subUnitId: null })], [prop({ unit: { id: 4, name: "ml" }, subUnit: null })]),
    ).toBe(true);
  });
  it("true when sub-unit differs from unit", () => {
    expect(
      isLineGroupChanged(
        [cur({ unitId: 3, subUnitId: null })],
        [prop({ unit: null, subUnit: { id: 7, name: "Zehe", perPurchase: 1 } })],
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
});
