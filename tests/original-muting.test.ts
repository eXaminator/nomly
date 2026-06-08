import { describe, it, expect } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { renderOriginalWithMuting } from "@/components/recipes/original-muting";

/** Flatten the rendered nodes into {text, kept} pieces for assertions. */
function pieces(node: ReactNode): { text: string; kept: boolean }[] {
  const arr = Array.isArray(node) ? node : [node];
  return arr.map((n) => {
    if (isValidElement(n)) {
      const props = n.props as { className: string; children: string };
      return { text: props.children, kept: props.className.includes("color-fg") };
    }
    return { text: String(n), kept: false };
  });
}

describe("renderOriginalWithMuting", () => {
  it("returns the plain string when no ranges are known", () => {
    expect(renderOriginalWithMuting("200 g Mehl", [])).toBe("200 g Mehl");
  });

  it("highlights the WHOLE line (incl. notes) when ranges cover it — lone row", () => {
    const text = "200 g Mehl, gesiebt";
    const p = pieces(renderOriginalWithMuting(text, [[0, text.length]]));
    expect(p).toHaveLength(1);
    expect(p[0]).toEqual({ text, kept: true });
  });

  it("mutes the gap between kept spans", () => {
    // "2-3 EL Honig oder Ahornsirup": keep "2-3 EL" + "oder Ahornsirup",
    // mute "Honig" in between.
    const text = "2-3 EL Honig oder Ahornsirup";
    const p = pieces(renderOriginalWithMuting(text, [
      [0, 6],
      [13, 28],
    ]));
    expect(p.map((x) => x.text)).toEqual(["2-3 EL", " Honig ", "oder Ahornsirup"]);
    expect(p.map((x) => x.kept)).toEqual([true, false, true]);
  });

  it("mutes a leading part before the first kept span", () => {
    const text = "2-3 EL Honig";
    const p = pieces(renderOriginalWithMuting(text, [[7, 12]]));
    expect(p.map((x) => x.text)).toEqual(["2-3 EL ", "Honig"]);
    expect(p.map((x) => x.kept)).toEqual([false, true]);
  });
});
