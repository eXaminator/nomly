import { describe, it, expect } from "vitest";
import {
  amountPrefixRange,
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
