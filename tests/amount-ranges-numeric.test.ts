import { describe, expect, it } from "vitest";
import { consumeQuantity } from "@/lib/recipe-import/ast/numeric";

describe("consumeQuantity low bound", () => {
  it("returns low bound for a real range", () => {
    expect(consumeQuantity(["2-3"])).toMatchObject({ quantity: 3, quantityLow: 2 });
  });
  it("min/max regardless of order/spacing", () => {
    expect(consumeQuantity(["100", "-", "200"])).toMatchObject({
      quantity: 200,
      quantityLow: 100,
    });
  });
  it("single amount has null low", () => {
    expect(consumeQuantity(["3"])).toMatchObject({ quantity: 3, quantityLow: null });
  });
  it("open-ended 'bis' has null low", () => {
    expect(consumeQuantity(["bis", "3"])).toMatchObject({
      quantity: 3,
      quantityLow: null,
    });
  });
});
