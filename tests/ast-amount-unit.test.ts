import { describe, expect, it } from "vitest";
import { lex } from "@/lib/recipe-import/ast/lexer";
import { renderNote, type Leaf } from "@/lib/recipe-import/ast/render-notes";
import { applyAmountUnit } from "@/lib/recipe-import/ast/passes/amount-unit";
import { applyOptional } from "@/lib/recipe-import/ast/passes/optional";
import { testQuantifierLookup } from "./_helpers/quantifiers";

const UNITS = new Set(["g", "kg", "ml", "l", "el", "tl", "tsp", "cup", "cups"]);
const QUANTIFIERS = testQuantifierLookup();

function run(line: string) {
  const leaves: Leaf[] = lex(line).map((t) => ({ ...t }));
  const isOptional = applyOptional(leaves);
  const au = applyAmountUnit(line, leaves, UNITS, { quantifiers: QUANTIFIERS });
  return { ...au, isOptional, note: renderNote(line, leaves) };
}

describe("ast amount/unit + optional passes", () => {
  it("extracts amount + unit, keeps the rest (incl. a semicolon) as note", () => {
    const r = run("200 g Mehl (Typ 405; gesiebt)");
    expect(r.quantity).toBe(200);
    expect(r.unitName).toBe("g");
    // Ingredient pass not built yet, so "Mehl" still rides in the note here.
    expect(r.note).toBe("Mehl, Typ 405; gesiebt");
  });

  it("resolves a unitless range to the high bound + exposes the expression", () => {
    const r = run("2-3 Eier");
    expect(r.quantity).toBe(3);
    expect(r.rangeExpression).toBe("2-3");
    expect(r.unitName).toBeNull();
  });

  it("keeps spaced slashes verbatim in the note", () => {
    const r = run("1 TL Salz (fein / grob)");
    expect(r.quantity).toBe(1);
    expect(r.unitName).toBe("TL");
    expect(r.note).toBe("Salz, fein / grob");
  });

  it("a bare unit with no number implies quantity 1", () => {
    const r = run("EL Honig");
    expect(r.quantity).toBe(1);
    expect(r.unitName).toBe("EL");
  });

  it("text amount 'eine' → 1", () => {
    const r = run("eine Prise Salz");
    expect(r.quantity).toBe(1);
  });

  it("optional marker sets the flag and a glued '.' is swallowed", () => {
    const r = run("opt. 2 EL Honig");
    expect(r.isOptional).toBe(true);
    expect(r.quantity).toBe(2);
    expect(r.unitName).toBe("EL");
    expect(r.note).toBe("Honig");
  });

  it("'optional' anywhere flips the flag and leaves no marker text", () => {
    const r = run("Tomaten optional");
    expect(r.isOptional).toBe(true);
    expect(r.note).toBe("Tomaten");
  });
});
