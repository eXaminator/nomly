import { describe, it, expect } from "vitest";
import {
  amountPrefixRange,
  trailingNoteRange,
} from "@/lib/recipe-import/source-ranges";

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
