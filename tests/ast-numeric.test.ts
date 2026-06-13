import { describe, expect, it } from "vitest";
import {
  consumeQuantity,
  formatRangeNumber,
  parseSingleNumericToken,
} from "@/lib/recipe-import/ast/numeric";

describe("ast numeric — parity with the legacy amount parser", () => {
  it("parses single tokens (fractions, glyphs, decimals)", () => {
    expect(parseSingleNumericToken("1/2")).toBe(0.5);
    expect(parseSingleNumericToken("½")).toBe(0.5);
    expect(parseSingleNumericToken("1½")).toBe(1.5);
    expect(parseSingleNumericToken("0,25")).toBe(0.25);
    expect(parseSingleNumericToken("2.5")).toBe(2.5);
  });

  it("resolves ranges to the high bound, keeps the expression + structured low", () => {
    // Mirrors recipe-import.test.ts range assertions.
    expect(consumeQuantity(["100-200"])).toEqual({ quantity: 200, rangeExpression: "100-200", quantityLow: 100 });
    expect(consumeQuantity(["1/2-1"])).toEqual({ quantity: 1, rangeExpression: "1/2-1", quantityLow: 0.5 });
    expect(consumeQuantity(["1/3-2/3"])).toEqual({ quantity: 0.667, rangeExpression: "1/3-2/3", quantityLow: 0.333 });
    expect(consumeQuantity(["0,25-0,4"])).toEqual({ quantity: 0.4, rangeExpression: "1/4-0,4", quantityLow: 0.25 });
    expect(consumeQuantity(["2-3"])).toEqual({ quantity: 3, rangeExpression: "2-3", quantityLow: 2 });
  });

  it("handles 'to'/'bis' range separators and 'bis' prefix", () => {
    expect(consumeQuantity(["4", "to", "6"])).toEqual({ quantity: 6, rangeExpression: "4-6", quantityLow: 4 });
    expect(consumeQuantity(["1", "bis", "2"])).toEqual({ quantity: 2, rangeExpression: "1-2", quantityLow: 1 });
    // Open-ended "bis 2" has no structured low bound.
    expect(consumeQuantity(["bis", "2"])).toEqual({ quantity: 2, rangeExpression: "bis 2", quantityLow: null });
  });

  it("additive connectors sum (no range expression)", () => {
    expect(consumeQuantity(["2", "+", "1/4"])).toEqual({ quantity: 2.25, rangeExpression: null, quantityLow: null });
  });

  it("formats range bounds as clean fractions or 2-place decimals", () => {
    expect(formatRangeNumber(0.25)).toBe("1/4");
    expect(formatRangeNumber(0.4)).toBe("0,4");
    expect(formatRangeNumber(3)).toBe("3");
  });
});
