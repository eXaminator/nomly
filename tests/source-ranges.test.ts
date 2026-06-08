import { describe, it, expect } from "vitest";
import {
  amountPrefixRange,
  decomposeSegment,
  findSegmentRange,
  trailingNoteRange,
} from "@/lib/recipe-import/source-ranges";

describe("findSegmentRange", () => {
  const line = "80 g Weizenmehl oder Dinkelmehl (oder glutenfreies Mehl)";

  it("locates the primary segment from the start", () => {
    expect(findSegmentRange(line, "80 g Weizenmehl", 0, false)).toEqual([0, 15]);
  });

  it("extends an alternative's start over its 'oder' connector", () => {
    // " oder Dinkelmehl" — the kept span includes "oder".
    const r = findSegmentRange(line, "Dinkelmehl", 15, true)!;
    expect(line.slice(r[0], r[1])).toBe("oder Dinkelmehl");
  });

  it("handles a connector behind an opening paren", () => {
    const r = findSegmentRange(line, "glutenfreies Mehl", 31, true)!;
    expect(line.slice(r[0], r[1])).toBe("oder glutenfreies Mehl");
  });

  it("returns null when the segment is not a literal substring", () => {
    expect(findSegmentRange(line, "Roggenmehl", 0, true)).toBeNull();
  });
});

describe("amountPrefixRange", () => {
  it("covers a range amount plus its unit", () => {
    const seg = "2-3 EL Honig";
    const r = amountPrefixRange(seg, true, "EL")!;
    expect(seg.slice(r[0], r[1])).toBe("2-3 EL");
  });

  it("covers a simple amount plus unit", () => {
    const seg = "100 g Käse";
    const r = amountPrefixRange(seg, true, "g")!;
    expect(seg.slice(r[0], r[1])).toBe("100 g");
  });

  it("stops after the number when there is no unit", () => {
    const seg = "3 Eier";
    const r = amountPrefixRange(seg, true, null)!;
    expect(seg.slice(r[0], r[1])).toBe("3");
  });

  it("returns null with no amount", () => {
    expect(amountPrefixRange("Honig", false, null)).toBeNull();
  });
});

describe("decomposeSegment", () => {
  const render = (
    seg: string,
    hasAmount: boolean,
    unit: string | null,
    name: string | null,
    notes: string | null,
    contentStart = 0,
  ) =>
    decomposeSegment(seg, hasAmount, unit, name, notes, contentStart).map((p) => ({
      text: seg.slice(p.range[0], p.range[1]),
      kind: p.kind,
    }));

  it("splits amount, name and a note that appears in the output", () => {
    expect(render("200 g Mehl, gesiebt", true, "g", "Mehl", "gesiebt")).toEqual([
      { text: "200 g", kind: "amount" },
      { text: " ", kind: "note" },
      { text: "Mehl", kind: "name" },
      { text: ", ", kind: "note" },
      { text: "gesiebt", kind: "note" },
    ]);
  });

  it("covers the whole segment with no gaps", () => {
    const seg = "2-3 EL Honig";
    const parts = decomposeSegment(seg, true, "EL", "Honig", null);
    expect(parts[0]).toEqual({ range: [0, 6], kind: "amount" });
    expect(parts.at(-1)).toEqual({ range: [7, 12], kind: "name" });
    expect(parts[0].range[0]).toBe(0);
    expect(parts.at(-1)!.range[1]).toBe(seg.length);
  });

  it("strikes a connector that appears in no output field", () => {
    // "oder" is in neither name nor notes → dropped (struck); the name is green.
    expect(render("oder Ahornsirup", false, null, "Ahornsirup", null)).toEqual([
      { text: "oder", kind: "dropped" },
      { text: " ", kind: "note" },
      { text: "Ahornsirup", kind: "name" },
    ]);
  });

  it("recognises the alt's own amount after a leading connector (not struck)", () => {
    // "oder 1 TL Backpulver": connector struck, but "1 TL" is the amount and
    // must NOT be struck even though "TL" isn't in the name.
    expect(render("oder 1 TL Backpulver", true, "TL", "Backpulver", null, 5)).toEqual([
      { text: "oder", kind: "dropped" },
      { text: " ", kind: "note" },
      { text: "1 TL", kind: "amount" },
      { text: " ", kind: "note" },
      { text: "Backpulver", kind: "name" },
    ]);
  });

  it("keeps a connector that DID make it into the notes", () => {
    // A previously-folded alternative lives in notes as "oder Ahornsirup" — so
    // here "oder" is part of the output and must NOT be struck.
    const parts = render("X oder Ahornsirup", false, null, "X", "oder Ahornsirup");
    expect(parts.find((p) => p.text === "oder")?.kind).toBe("note");
  });
});

describe("trailingNoteRange", () => {
  it("finds a trailing note and swallows the leading comma", () => {
    const seg = "pancetta, diced";
    const r = trailingNoteRange(seg, "diced")!;
    expect(seg.slice(r[0], r[1])).toBe(", diced");
  });

  it("returns null when the note isn't present", () => {
    expect(trailingNoteRange("pancetta", "diced")).toBeNull();
  });
});
