import { describe, expect, it } from "vitest";
import { lex } from "@/lib/recipe-import/ast/lexer";
import type { Leaf } from "@/lib/recipe-import/ast/render-notes";
import { splitSegments } from "@/lib/recipe-import/ast/segment";

const leavesOf = (s: string): Leaf[] => lex(s).map((t) => ({ ...t }));
const textOf = (seg: { leaves: Leaf[] }) => seg.leaves.map((l) => l.text).join(" ");

describe("ast splitSegments", () => {
  it("splits an 'or' alternative", () => {
    const segs = splitSegments(leavesOf("200 g butter or margarine"));
    expect(segs).toHaveLength(2);
    expect(textOf(segs[0])).toBe("200 g butter");
    expect(segs[0].connector).toBeNull();
    expect(textOf(segs[1])).toBe("margarine");
    expect(segs[1].connector).toBe("or");
    expect(segs[1].isAlternative).toBe(true);
  });

  it("splits an 'und' co-ingredient (before any comma)", () => {
    const segs = splitSegments(leavesOf("Salz und Pfeffer"));
    expect(segs).toHaveLength(2);
    expect(segs[1].connector).toBe("und");
    expect(segs[1].isAlternative).toBe(false);
  });

  it("alternatives still split after a comma; conjunctions do not", () => {
    const alt = splitSegments(leavesOf("onion, finely chopped, or 2 shallots"));
    expect(alt).toHaveLength(2);
    expect(alt[1].connector).toBe("or");

    // 'und' after a comma is a prep note, not a split.
    const conj = splitSegments(leavesOf("Tomaten, gehackt und gewürfelt"));
    expect(conj).toHaveLength(1);
  });

  it("does not split a conjunction inside parentheses", () => {
    const segs = splitSegments(leavesOf("Brühe (Gemüse und Fleisch)"));
    expect(segs).toHaveLength(1);
  });
});
