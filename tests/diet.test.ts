import { describe, it, expect } from "vitest";
import { deriveDiet } from "@/lib/recipes/diet";

describe("deriveDiet", () => {
  it("all vegan ingredients → definite vegan + vegetarian", () => {
    expect(deriveDiet(["vegan", "vegan", "vegan"])).toEqual({
      isVegan: true,
      isVegetarian: true,
      confidence: "definite",
    });
  });

  it("mix of vegan + vegetarian → definite vegetarian only", () => {
    expect(deriveDiet(["vegan", "vegetarian", "vegan"])).toEqual({
      isVegan: false,
      isVegetarian: true,
      confidence: "definite",
    });
  });

  it("any meat ingredient → definite neither (even with nulls)", () => {
    expect(deriveDiet(["vegan", "meat", null])).toEqual({
      isVegan: false,
      isVegetarian: false,
      confidence: "definite",
    });
  });

  it("nulls with all tagged vegan → probable vegan", () => {
    expect(deriveDiet(["vegan", null, "vegan"])).toEqual({
      isVegan: true,
      isVegetarian: true,
      confidence: "probable",
    });
  });

  it("nulls with at least one tagged vegetarian → probable vegetarian", () => {
    expect(deriveDiet(["vegan", null, "vegetarian"])).toEqual({
      isVegan: false,
      isVegetarian: true,
      confidence: "probable",
    });
  });

  it("only nulls (no tagged signal) → unknown", () => {
    expect(deriveDiet([null, null, null])).toEqual({
      isVegan: null,
      isVegetarian: null,
      confidence: "unknown",
    });
  });

  it("empty list → vacuous definite vegan", () => {
    expect(deriveDiet([])).toEqual({
      isVegan: true,
      isVegetarian: true,
      confidence: "definite",
    });
  });
});
