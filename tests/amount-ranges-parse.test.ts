import { describe, expect, it } from "vitest";
import { parseSegment, type SegmentLookups } from "@/lib/recipe-import/ast/parse-line";

const lookups = (): SegmentLookups => ({
  knownUnitTokens: new Set(["el", "g", "tl"]),
  catalog: [],
});

describe("amount ranges in the parse", () => {
  it("2-3 EL → quantity 3, quantityLow 2, no range text in notes", () => {
    const r = parseSegment("2-3 EL Zucker", lookups());
    expect(r.quantity).toBe(3);
    expect(r.quantityLow).toBe(2);
    expect(r.notes ?? "").not.toContain("2-3");
  });
  it("100-200 g", () => {
    const r = parseSegment("100-200 g Mehl", lookups());
    expect(r.quantity).toBe(200);
    expect(r.quantityLow).toBe(100);
  });
  it("single amount → null low", () => {
    const r = parseSegment("3 EL Zucker", lookups());
    expect(r.quantity).toBe(3);
    expect(r.quantityLow).toBeNull();
  });
  it("open-ended 'bis 3 EL' keeps range in notes, null low", () => {
    const r = parseSegment("bis 3 EL Zucker", lookups());
    expect(r.quantity).toBe(3);
    expect(r.quantityLow).toBeNull();
    expect(r.notes ?? "").toContain("bis 3");
  });
});
