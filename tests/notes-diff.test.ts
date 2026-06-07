import { describe, expect, it } from "vitest";
import { diffNotes } from "@/components/recipes/notes-diff";

describe("diffNotes — word-level note diff for the reparse dialog", () => {
  it("marks nothing when both sides are equal", () => {
    const d = diffNotes("nach Geschmack", "nach Geschmack");
    expect(d.current).toEqual([{ text: "nach Geschmack", changed: false }]);
    expect(d.proposed).toEqual([{ text: "nach Geschmack", changed: false }]);
  });

  it("marks only the differing word (case change)", () => {
    const d = diffNotes("nach geschmack", "nach Geschmack");
    expect(d.current).toEqual([
      { text: "nach", changed: false },
      { text: "geschmack", changed: true },
    ]);
    expect(d.proposed).toEqual([
      { text: "nach", changed: false },
      { text: "Geschmack", changed: true },
    ]);
  });

  it("marks insertions only on the proposed side", () => {
    const d = diffNotes("gewürfelt", "fein gewürfelt");
    expect(d.current).toEqual([{ text: "gewürfelt", changed: false }]);
    expect(d.proposed).toEqual([
      { text: "fein", changed: true },
      { text: "gewürfelt", changed: false },
    ]);
  });

  it("merges contiguous changed words into one segment", () => {
    const d = diffNotes(
      "small, 1 inch, head, sliced into",
      "small head, sliced into 1-inch pieces",
    );
    // Just shape guarantees: segments alternate and re-join to the inputs.
    const join = (segs: { text: string }[]) => segs.map((s) => s.text).join(" ");
    expect(join(d.current)).toBe("small, 1 inch, head, sliced into");
    expect(join(d.proposed)).toBe("small head, sliced into 1-inch pieces");
    expect(d.proposed.some((s) => s.changed)).toBe(true);
    expect(d.proposed.some((s) => !s.changed)).toBe(true);
  });

  it("handles a null side as all-changed on the other", () => {
    const d = diffNotes(null, "frisch");
    expect(d.current).toEqual([]);
    expect(d.proposed).toEqual([{ text: "frisch", changed: true }]);
  });
});
