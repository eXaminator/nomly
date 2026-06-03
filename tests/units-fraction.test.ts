import { describe, it, expect } from "vitest";
import { toFractionDisplay, renderFraction } from "@/lib/units/fraction";

describe("renderFraction", () => {
  it("uses the Unicode glyph when one exists for the reduced fraction", () => {
    expect(renderFraction(1, 2)).toBe("½");
    expect(renderFraction(1, 3)).toBe("⅓");
    expect(renderFraction(2, 3)).toBe("⅔");
    expect(renderFraction(1, 4)).toBe("¼");
    expect(renderFraction(3, 4)).toBe("¾");
    expect(renderFraction(1, 8)).toBe("⅛");
    expect(renderFraction(3, 8)).toBe("⅜");
    expect(renderFraction(5, 8)).toBe("⅝");
    expect(renderFraction(7, 8)).toBe("⅞");
    expect(renderFraction(1, 6)).toBe("⅙");
    expect(renderFraction(5, 6)).toBe("⅚");
  });

  it("falls back to slash text when no glyph exists", () => {
    expect(renderFraction(1, 5)).toBe("1/5");
    expect(renderFraction(1, 16)).toBe("1/16");
  });
});

describe("toFractionDisplay", () => {
  it("converts exact stored fractions to a glyph", () => {
    expect(toFractionDisplay(0.25)).toBe("¼");
    expect(toFractionDisplay(0.5)).toBe("½");
    expect(toFractionDisplay(0.75)).toBe("¾");
    expect(toFractionDisplay(1 / 3)).toBe("⅓");
    expect(toFractionDisplay(2 / 3)).toBe("⅔");
    expect(toFractionDisplay(0.125)).toBe("⅛");
    expect(toFractionDisplay(1 / 6)).toBe("⅙");
  });

  it("renders mixed numbers with the glyph joined tight", () => {
    expect(toFractionDisplay(1.5)).toBe("1½");
    expect(toFractionDisplay(2 + 2 / 3)).toBe("2⅔");
    expect(toFractionDisplay(1.25)).toBe("1¼");
  });

  it("resolves a value typed to 2 decimals to its nearest fraction", () => {
    // 0,33 typed by hand is within tolerance of 1/3
    expect(toFractionDisplay(0.33)).toBe("⅓");
    expect(toFractionDisplay(0.67)).toBe("⅔");
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
