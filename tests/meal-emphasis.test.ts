import { describe, expect, it } from "vitest";
import { mealEmphasisFor } from "@/lib/recipes/meal-emphasis";

const primary = { id: 1 };
const altA = { id: 2 };
const altB = { id: 3 };
const group = [primary, altA, altB];

describe("mealEmphasisFor", () => {
  it("emphasizes the alternative this meal bought and mutes the rest", () => {
    const chosen = new Set([altA.id]);
    expect(mealEmphasisFor(primary, group, chosen)).toBe("muted");
    expect(mealEmphasisFor(altA, group, chosen)).toBe("chosen");
    expect(mealEmphasisFor(altB, group, chosen)).toBe("muted");
  });

  it("emphasizes the primary when IT is the one that was bought", () => {
    const chosen = new Set([primary.id]);
    expect(mealEmphasisFor(primary, group, chosen)).toBe("chosen");
    expect(mealEmphasisFor(altA, group, chosen)).toBe("muted");
  });

  it("can emphasize more than one member", () => {
    const chosen = new Set([primary.id, altB.id]);
    expect(mealEmphasisFor(primary, group, chosen)).toBe("chosen");
    expect(mealEmphasisFor(altA, group, chosen)).toBe("muted");
    expect(mealEmphasisFor(altB, group, chosen)).toBe("chosen");
  });

  it("leaves the group alone when the meal bought none of it", () => {
    // The meal was planned but never added to the shopping list, or this
    // group was dropped from it — muting everything would misread as
    // "not needed".
    const chosen = new Set([999]);
    for (const row of group) {
      expect(mealEmphasisFor(row, group, chosen)).toBe("default");
    }
  });

  it("leaves a group with nothing to choose between alone", () => {
    expect(mealEmphasisFor(primary, [primary], new Set([primary.id]))).toBe(
      "default",
    );
  });

  it("leaves everything alone with no meal in context", () => {
    expect(mealEmphasisFor(altA, group, undefined)).toBe("default");
  });
});
