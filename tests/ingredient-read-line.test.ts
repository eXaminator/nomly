import { describe, expect, it } from "vitest";
import { displayAmount } from "@/components/recipes/ingredient-read-line";

describe("displayAmount", () => {
  it("returns the literal quantity when set", () => {
    expect(displayAmount({ quantity: 200 })).toBe("200");
  });

  it("returns the quantifier value when quantity is null", () => {
    expect(displayAmount({ quantity: null, quantifierValue: 2 })).toBe("2");
  });

  it("returns the quantifier name when both quantity and quantifierValue are null", () => {
    expect(
      displayAmount({ quantity: null, quantifierValue: null, quantifierName: "einige" }),
    ).toBe("einige");
  });

  it("prefers the matched source word over the canonical name for a value-less quantifier", () => {
    // "noch mehr" (alias of canonical "mehr") should read as "noch mehr".
    expect(
      displayAmount({
        quantity: null,
        quantifierValue: null,
        quantifierName: "mehr",
        quantifierSource: "noch mehr",
      }),
    ).toBe("noch mehr");
  });

  it("shows the number (not the source) when the quantifier has a value", () => {
    // A value-bearing quantifier still renders its number ("a"/"ein" → 1).
    expect(
      displayAmount({
        quantity: null,
        quantifierValue: 1,
        quantifierName: "ein",
        quantifierSource: "a",
      }),
    ).toBe("1");
  });

  it("returns empty string when all amount fields are null/undefined", () => {
    expect(displayAmount({ quantity: null })).toBe("");
  });

  it("formats a range (quantityLow + quantity) containing both bounds", () => {
    const result = displayAmount({ quantity: 3, quantityLow: 2 });
    expect(result).toContain("2");
    expect(result).toContain("3");
  });
});
