/**
 * Pure unit tests for the quantifierTooltipText helper exported from
 * ingredient-read-line. Verifies that the tooltip prefers the original
 * user-typed text over the canonical names, with correct fallbacks.
 */

import { describe, expect, it } from "vitest";
import { quantifierTooltipText } from "@/components/recipes/ingredient-read-line";

describe("quantifierTooltipText", () => {
  it("uses quantifierSource + unitSource when both present", () => {
    expect(
      quantifierTooltipText({ quantifierSource: "a", unitSource: "bunch" }),
    ).toBe("a bunch");
  });

  it("falls back to quantifierName + unitLabel when source fields are null", () => {
    expect(
      quantifierTooltipText({
        quantifierSource: null,
        quantifierName: "ein",
        unitSource: null,
        unitLabel: "Bund",
      }),
    ).toBe("ein Bund");
  });

  it("mixes sources: quantifierSource present, unitSource absent → use unitLabel", () => {
    expect(
      quantifierTooltipText({
        quantifierSource: "einige",
        quantifierName: "einige",
        unitSource: "Stiele",
        unitLabel: "Stiel",
      }),
    ).toBe("einige Stiele");
  });

  it("uses only quantifier part when no unit available", () => {
    expect(
      quantifierTooltipText({ quantifierSource: "zwei", unitSource: null }),
    ).toBe("zwei");
  });

  it("returns empty string when all fields are absent/null/empty", () => {
    expect(quantifierTooltipText({})).toBe("");
  });

  it("trims whitespace from both parts", () => {
    expect(
      quantifierTooltipText({ quantifierSource: "  a  ", unitSource: " bunch " }),
    ).toBe("a bunch");
  });

  it("omits unit part when it is an empty string after trimming", () => {
    expect(
      quantifierTooltipText({ quantifierSource: "a", unitSource: "  " }),
    ).toBe("a");
  });
});
