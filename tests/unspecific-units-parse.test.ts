import { describe, expect, it } from "vitest";
import { parseSegment, type SegmentLookups } from "@/lib/recipe-import/ast/parse-line";

const lookups = (over: Partial<SegmentLookups> = {}): SegmentLookups => ({
  knownUnitTokens: new Set(["etwas", "a sprinkle", "ein schuss", "g"]),
  unspecificUnitTokens: new Set(["etwas", "a sprinkle", "ein schuss"]),
  maxUnitTokens: 2,
  catalog: [],
  ...over,
});

describe("unspecific units in the amount pass", () => {
  it("single-token unspecific gets a null quantity", () => {
    const r = parseSegment("etwas Öl", lookups());
    expect(r.quantity).toBeNull();
    expect(r.unitName).toBe("etwas");
  });

  it("drops a leading number before an unspecific unit", () => {
    const r = parseSegment("2 etwas Salz", lookups());
    expect(r.quantity).toBeNull();
    expect(r.unitName).toBe("etwas");
  });

  it("matches a multi-word unspecific alias whose first word is an article", () => {
    const r = parseSegment("a sprinkle of salt", lookups());
    expect(r.quantity).toBeNull();
    expect(r.unitName?.toLowerCase()).toBe("a sprinkle");
  });

  it("matches a multi-word German unspecific alias", () => {
    const r = parseSegment("ein Schuss Öl", lookups());
    expect(r.quantity).toBeNull();
    expect(r.unitName?.toLowerCase()).toBe("ein schuss");
  });

  it("does NOT match a near-miss partial of a multi-word alias", () => {
    // "a pinch" is not a registered alias; "a" must not be claimed as the unit.
    const r = parseSegment("a pinch of salt", lookups());
    expect(r.unitName).not.toBe("a sprinkle");
  });

  it("a normal bare unit still defaults to quantity 1", () => {
    const r = parseSegment("g Mehl", lookups());
    expect(r.quantity).toBe(1);
    expect(r.unitName).toBe("g");
  });
});
