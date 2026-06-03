import { describe, it, expect } from "vitest";
import { toFractionDisplay } from "@/lib/units/fraction";

describe("toFractionDisplay", () => {
  it("converts exact stored fractions to slash text", () => {
    expect(toFractionDisplay(0.25)).toBe("1/4");
    expect(toFractionDisplay(0.5)).toBe("1/2");
    expect(toFractionDisplay(0.75)).toBe("3/4");
    expect(toFractionDisplay(1 / 3)).toBe("1/3");
    expect(toFractionDisplay(2 / 3)).toBe("2/3");
    expect(toFractionDisplay(0.125)).toBe("1/8");
    expect(toFractionDisplay(1 / 6)).toBe("1/6");
  });

  it("reduces to the smallest denominator", () => {
    expect(toFractionDisplay(2 / 4)).toBe("1/2");
    expect(toFractionDisplay(6 / 8)).toBe("3/4");
  });

  it("renders mixed numbers with a separating space", () => {
    expect(toFractionDisplay(1.5)).toBe("1 1/2");
    expect(toFractionDisplay(2 + 2 / 3)).toBe("2 2/3");
    expect(toFractionDisplay(1.25)).toBe("1 1/4");
  });

  it("resolves a value typed to 2 decimals to its nearest fraction", () => {
    // 0,33 typed by hand is within tolerance of 1/3
    expect(toFractionDisplay(0.33)).toBe("1/3");
    expect(toFractionDisplay(0.67)).toBe("2/3");
  });

  it("returns null for values that are not close to a clean fraction", () => {
    expect(toFractionDisplay(0.3)).toBeNull(); // 3/10, too far from 1/3
    expect(toFractionDisplay(0.4)).toBeNull();
    expect(toFractionDisplay(0.13)).toBeNull(); // outside the 0.005 tolerance of 1/8
  });

  it("returns null for whole numbers (decimal display handles them)", () => {
    expect(toFractionDisplay(0)).toBeNull();
    expect(toFractionDisplay(1)).toBeNull();
    expect(toFractionDisplay(2)).toBeNull();
  });

  it("returns null for null, negative, or non-finite input", () => {
    expect(toFractionDisplay(null)).toBeNull();
    expect(toFractionDisplay(-0.5)).toBeNull();
    expect(toFractionDisplay(Number.NaN)).toBeNull();
    expect(toFractionDisplay(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
