import { describe, expect, it } from "vitest";
import { formatAmount } from "@/components/recipes/ingredient-read-line";

describe("formatAmount range", () => {
  it("renders low–high for a range", () => {
    expect(formatAmount(3, 2)).toBe("2–3");
  });
  it("renders single value when no low", () => {
    expect(formatAmount(3, null)).toBe("3");
  });
  it("applies fraction formatting to both bounds", () => {
    expect(formatAmount(1, 0.5, { fraction: true })).toBe("1/2–1");
  });
  it("empty for null quantity", () => {
    expect(formatAmount(null, null)).toBe("");
  });
  it("ignores low when high is null", () => {
    expect(formatAmount(null, 2)).toBe("");
  });
});
