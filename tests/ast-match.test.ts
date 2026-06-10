import { describe, expect, it } from "vitest";
import type { IngredientCatalog } from "@/lib/recipe-import/matching";
import { lex } from "@/lib/recipe-import/ast/lexer";
import { renderNote, type Leaf } from "@/lib/recipe-import/ast/render-notes";
import { applyOptional } from "@/lib/recipe-import/ast/passes/optional";
import { applyAmountUnit } from "@/lib/recipe-import/ast/passes/amount-unit";
import { applyMatch } from "@/lib/recipe-import/ast/passes/match-ingredient";

const UNITS = new Set(["g", "kg", "ounce", "ounces", "el", "tl"]);
const CATALOG: IngredientCatalog = [
  { ingredientId: 1, canonicalName: "bread", aliasName: "bread", tokens: ["bread"] },
  { ingredientId: 2, canonicalName: "Mehl", aliasName: "Mehl", tokens: ["mehl"] },
];

function run(line: string) {
  const leaves: Leaf[] = lex(line).map((t) => ({ ...t }));
  applyOptional(leaves);
  const au = applyAmountUnit(line, leaves, UNITS);
  const m = applyMatch(line, leaves, CATALOG);
  return { ...au, ...m, note: renderNote(line, leaves) };
}

describe("ast match pass — covered tokens → source leaves, verbatim notes", () => {
  it("matches 'bread' and keeps the semicolon + everything else verbatim", () => {
    const r = run("12 ounces crusty whole-wheat bread, cubed (1-inch; about 10 cups)");
    expect(r.matched).toBe(true);
    expect(r.name).toBe("bread");
    expect(r.quantity).toBe(12);
    expect(r.unitName).toBe("ounces");
    expect(r.note).toBe("crusty whole-wheat, cubed, 1-inch; about 10 cups");
  });

  it("matches 'Mehl', leaves the post-comma remainder verbatim (semicolon kept)", () => {
    const r = run("200 g Mehl, gesiebt; warm");
    expect(r.matched).toBe(true);
    expect(r.name).toBe("Mehl");
    expect(r.note).toBe("gesiebt; warm");
  });

  it("unwraps a root paren on a matched line", () => {
    const r = run("200 g Mehl (Typ 405; gesiebt)");
    expect(r.name).toBe("Mehl");
    expect(r.note).toBe("Typ 405; gesiebt");
  });

  it("no catalog hit → name is the pre-comma region, note is the rest", () => {
    const r = run("200 g Glitzerstaub, fein");
    expect(r.matched).toBe(false);
    expect(r.name).toBe("Glitzerstaub");
    expect(r.note).toBe("fein");
  });
});
