import { describe, it, expect } from "vitest";
import { deriveDiet } from "@/lib/recipes/diet";

describe("deriveDiet", () => {
  it("all vegan ingredients → vegan + vegetarian", () => {
    expect(deriveDiet(["vegan", "vegan", "vegan"])).toEqual({
      isVegan: true,
      isVegetarian: true,
    });
  });

  it("mix of vegan + vegetarian → vegetarian only", () => {
    expect(deriveDiet(["vegan", "vegetarian", "vegan"])).toEqual({
      isVegan: false,
      isVegetarian: true,
    });
  });

  it("any meat ingredient → neither (definitive, even with nulls)", () => {
    expect(deriveDiet(["vegan", "meat", null])).toEqual({
      isVegan: false,
      isVegetarian: false,
    });
  });

  it("any untagged ingredient (no meat) → unknown", () => {
    expect(deriveDiet(["vegan", null, "vegetarian"])).toEqual({
      isVegan: null,
      isVegetarian: null,
    });
  });

  it("empty list (no contributing ingredients) → vacuously vegan", () => {
    expect(deriveDiet([])).toEqual({ isVegan: true, isVegetarian: true });
  });
});
