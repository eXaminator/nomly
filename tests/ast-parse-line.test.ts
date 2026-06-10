import { describe, expect, it } from "vitest";
import type { IngredientCatalog } from "@/lib/recipe-import/matching";
import { parseSegment, type SegmentLookups } from "@/lib/recipe-import/ast/parse-line";

const lookups: SegmentLookups = {
  knownUnitTokens: new Set(["g", "kg", "ml", "l", "ounce", "ounces", "cup", "cups", "el", "tl"]),
  catalog: [
    { ingredientId: 1, canonicalName: "bread", aliasName: "bread", tokens: ["bread"] },
    { ingredientId: 2, canonicalName: "Käse", aliasName: "Käse", tokens: ["kase"] },
  ] satisfies IngredientCatalog,
};

describe("ast parseSegment — structured row + range-note assembly", () => {
  it("unitless range → high bound + bare range note", () => {
    const r = parseSegment("2-3 Eier", lookups);
    expect(r.quantity).toBe(3);
    expect(r.name).toBe("Eier");
    expect(r.notes).toBe("2-3");
    expect(r.fixedAmount).toBe(false);
  });

  it("range with unit → high bound + 'lo-hi unit' note", () => {
    const r = parseSegment("100-200 g Käse", lookups);
    expect(r.quantity).toBe(200);
    expect(r.unitName).toBe("g");
    expect(r.name).toBe("Käse");
    expect(r.notes).toBe("100-200 g");
  });

  it("matched line keeps the verbatim remainder (semicolon preserved)", () => {
    const r = parseSegment("12 ounces crusty whole-wheat bread, cubed (1-inch; about 10 cups)", lookups);
    expect(r.matched).toBe(true);
    expect(r.name).toBe("bread");
    expect(r.notes).toBe("crusty whole-wheat, cubed, 1-inch; about 10 cups");
  });

  it("no amount → fixedAmount true", () => {
    const r = parseSegment("Salz", lookups);
    expect(r.quantity).toBeNull();
    expect(r.fixedAmount).toBe(true);
    expect(r.name).toBe("Salz");
  });
});
