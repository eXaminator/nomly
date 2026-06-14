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

  it("returns empty string when all amount fields are null/undefined", () => {
    expect(displayAmount({ quantity: null })).toBe("");
  });

  it("formats a range (quantityLow + quantity) containing both bounds", () => {
    const result = displayAmount({ quantity: 3, quantityLow: 2 });
    expect(result).toContain("2");
    expect(result).toContain("3");
  });
});
