import { describe, expect, it } from "vitest";
import { ingredientToPayload, rangeError } from "@/components/recipes/payload";
import { emptyIngredient } from "@/components/recipes/types";

const base = () => ({ ...emptyIngredient(), name: "Zucker", quantity: "3" });

describe("range payload + validation", () => {
  it("serializes a valid range", () => {
    const p = ingredientToPayload({ ...base(), isRange: true, quantityLow: "2" });
    expect(p).toMatchObject({ quantity: 3, quantityLow: 2 });
  });
  it("null low when not a range", () => {
    expect(ingredientToPayload(base())).toMatchObject({ quantity: 3, quantityLow: null });
  });
  it("ignores a low value when range mode is off", () => {
    const p = ingredientToPayload({ ...base(), isRange: false, quantityLow: "2" });
    expect(p).toMatchObject({ quantityLow: null });
  });
  it("rangeError on low >= high", () => {
    expect(rangeError({ ...base(), isRange: true, quantityLow: "3" })).toBe(true);
    expect(rangeError({ ...base(), isRange: true, quantityLow: "5" })).toBe(true);
  });
  it("rangeError on empty/non-numeric low in range mode", () => {
    expect(rangeError({ ...base(), isRange: true, quantityLow: "" })).toBe(true);
    expect(rangeError({ ...base(), isRange: true, quantityLow: "abc" })).toBe(true);
  });
  it("no error for a valid range or a single amount", () => {
    expect(rangeError({ ...base(), isRange: true, quantityLow: "2" })).toBe(false);
    expect(rangeError(base())).toBe(false);
  });
});
