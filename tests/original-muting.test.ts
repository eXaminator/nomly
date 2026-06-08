import { describe, it, expect } from "vitest";
import { isValidElement, type ReactNode } from "react";
import {
  renderOriginalWithMuting,
  type HighlightPart,
} from "@/components/recipes/original-muting";

/** Flatten the rendered nodes into {text, tone} pieces for assertions. */
function pieces(node: ReactNode): { text: string; tone: string }[] {
  const arr = Array.isArray(node) ? node : [node];
  return arr.map((n) => {
    if (isValidElement(n)) {
      const props = n.props as { className: string; children: string };
      const tone = props.className.includes("line-through")
        ? "dropped"
        : props.className.includes("color-accent")
          ? "amount"
          : props.className.includes("color-success")
            ? "name"
            : props.className.includes("opacity-50")
              ? "muted"
              : "note";
      return { text: props.children, tone };
    }
    return { text: String(n), tone: "plain" };
  });
}

const part = (range: [number, number], kind: HighlightPart["kind"]): HighlightPart => ({
  range,
  kind,
});

describe("renderOriginalWithMuting", () => {
  it("returns the plain string when no parts are known", () => {
    expect(renderOriginalWithMuting("200 g Mehl", [])).toBe("200 g Mehl");
  });

  it("colours amount, name and note distinctly (lone row, nothing muted)", () => {
    const text = "200 g Mehl, gesiebt";
    const p = pieces(
      renderOriginalWithMuting(text, [
        part([0, 5], "amount"),
        part([5, 6], "note"),
        part([6, 10], "name"),
        part([10, 19], "note"),
      ]),
    );
    expect(p).toEqual([
      { text: "200 g", tone: "amount" },
      { text: " ", tone: "note" },
      { text: "Mehl", tone: "name" },
      { text: ", gesiebt", tone: "note" },
    ]);
  });

  it("strikes through a dropped part", () => {
    const text = "oder Ahornsirup";
    const p = pieces(
      renderOriginalWithMuting(text, [part([0, 4], "dropped"), part([5, 15], "name")]),
    );
    expect(p).toEqual([
      { text: "oder", tone: "dropped" },
      { text: " ", tone: "muted" },
      { text: "Ahornsirup", tone: "name" },
    ]);
  });

  it("mutes text that belongs to other rows", () => {
    // Primary "Honig" line: keep "2-3 EL" (amount) + "Honig" (name), mute the
    // alternative tail "oder Ahornsirup".
    const text = "2-3 EL Honig oder Ahornsirup";
    const p = pieces(
      renderOriginalWithMuting(text, [part([0, 6], "amount"), part([7, 12], "name")]),
    );
    expect(p).toEqual([
      { text: "2-3 EL", tone: "amount" },
      { text: " ", tone: "muted" },
      { text: "Honig", tone: "name" },
      { text: " oder Ahornsirup", tone: "muted" },
    ]);
  });
});
