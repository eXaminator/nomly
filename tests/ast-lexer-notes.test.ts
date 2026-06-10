import { describe, expect, it } from "vitest";
import { lex, stitch } from "@/lib/recipe-import/ast/lexer";
import { renderNote, type Leaf } from "@/lib/recipe-import/ast/render-notes";

/** Helper: lex, then mark tokens whose exact text is in `consume` as consumed. */
function leavesWithConsumed(source: string, consume: string[]): Leaf[] {
  const want = [...consume];
  return lex(source).map((t) => {
    const idx = want.indexOf(t.text);
    if (idx >= 0) {
      want.splice(idx, 1);
      return { ...t, consumed: true };
    }
    return { ...t };
  });
}

describe("ast lexer — losslessness", () => {
  const samples = [
    "200 g Mehl (Typ 405; gesiebt)",
    "12 ounces crusty whole-wheat bread, cubed (1-inch; about 10 cups)",
    "1 TL Salz (fein / grob)",
    "0,5 l Wasser",
    "1/2-1 cup peanut butter",
    "500 g peanut butter (natural, no sugar added) smooth",
    "2 g Erbsen, TK, saftig",
  ];
  for (const s of samples) {
    it(`round-trips: ${s}`, () => {
      expect(stitch(s, lex(s))).toBe(s);
    });
  }
});

describe("ast renderNote — the note rule", () => {
  it("removes a middle span → comma between survivors", () => {
    const lv = leavesWithConsumed("finely chopped onion warm", ["onion"]);
    expect(renderNote("finely chopped onion warm", lv)).toBe("finely chopped, warm");
  });

  it("trims a leading removed run (no leading comma)", () => {
    const src = "200 g Mehl, gesiebt; warm";
    const lv = leavesWithConsumed(src, ["200", "g", "Mehl"]);
    expect(renderNote(src, lv)).toBe("gesiebt; warm");
  });

  it("unwraps a root-level paren and keeps its content verbatim (semicolon!)", () => {
    const src = "200 g Mehl (Typ 405; gesiebt)";
    const lv = leavesWithConsumed(src, ["200", "g", "Mehl"]);
    expect(renderNote(src, lv)).toBe("Typ 405; gesiebt");
  });

  it("keeps a spaced slash and an unspaced slash verbatim", () => {
    const a = "1 TL Salz (fein / grob)";
    expect(renderNote(a, leavesWithConsumed(a, ["1", "TL", "Salz"]))).toBe("fein / grob");
    const b = "200 g Mehl (fein/grob gemahlen)";
    expect(renderNote(b, leavesWithConsumed(b, ["200", "g", "Mehl"]))).toBe(
      "fein/grob gemahlen",
    );
  });

  it("keeps nested parentheses, unwraps only the root", () => {
    const src = "x (a (b) c)";
    const lv = leavesWithConsumed(src, ["x"]);
    expect(renderNote(src, lv)).toBe("a (b) c");
  });

  it("collapses comma runs and trims edges", () => {
    const src = "a , , b ,";
    expect(renderNote(src, leavesWithConsumed(src, []))).toBe("a, b");
  });

  it("strips brackets, keeps the content", () => {
    const src = "200 g Mehl [Typ 405]";
    const lv = leavesWithConsumed(src, ["200", "g", "Mehl"]);
    expect(renderNote(src, lv)).toBe("Typ 405");
  });
});
