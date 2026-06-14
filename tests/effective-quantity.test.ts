import { describe, it, expect } from "vitest";
import { effectiveQuantity } from "@/lib/recipes/effective-quantity";

const byId = new Map([
  [7, { id: 7, name: "zwei", value: 2 }],
  [8, { id: 8, name: "einige", value: null }],
]);

describe("effectiveQuantity", () => {
  it("uses the literal quantity when present", () => {
    expect(effectiveQuantity({ quantity: 200, quantifierId: null }, byId)).toBe(200);
  });
  it("falls back to a numeric quantifier value", () => {
    expect(effectiveQuantity({ quantity: null, quantifierId: 7 }, byId)).toBe(2);
  });
  it("is null for an unspecified quantifier", () => {
    expect(effectiveQuantity({ quantity: null, quantifierId: 8 }, byId)).toBeNull();
  });
  it("is null when there is no amount at all", () => {
    expect(effectiveQuantity({ quantity: null, quantifierId: null }, byId)).toBeNull();
  });
  it("is null for an unknown quantifier id", () => {
    expect(effectiveQuantity({ quantity: null, quantifierId: 999 }, byId)).toBeNull();
  });
});
