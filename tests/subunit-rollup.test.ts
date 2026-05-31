import { describe, it, expect } from "vitest";
import {
  ceilToWhole,
  groupSubUnitTotals,
  type SubUnitRef,
} from "@/lib/shopping/subunit-rollup";

const STAEBCHEN: SubUnitRef = {
  id: 10,
  name: "Stäbchen",
  plural: "Stäbchen",
  parent: null,
};
const SCHEIBE: SubUnitRef = {
  id: 11,
  name: "Scheibe",
  plural: "Scheiben",
  parent: null,
};

describe("groupSubUnitTotals", () => {
  it("sums each standalone custom unit on its own, preserving first-seen order", () => {
    const totals = groupSubUnitTotals([
      { quantity: 5, subUnit: STAEBCHEN },
      { quantity: 3, subUnit: SCHEIBE },
      { quantity: 17, subUnit: STAEBCHEN },
    ]);
    expect(totals).toEqual([
      { quantity: 22, subUnitId: 10, subUnitName: "Stäbchen" },
      { quantity: 3, subUnitId: 11, subUnitName: "Scheiben" },
    ]);
  });

  it("applies the plural by amount (singular at exactly 1)", () => {
    const [one] = groupSubUnitTotals([{ quantity: 1, subUnit: SCHEIBE }]);
    expect(one).toEqual({ quantity: 1, subUnitId: 11, subUnitName: "Scheibe" });
  });

  it("yields a null quantity when a custom unit's contributions are all open-ended", () => {
    const totals = groupSubUnitTotals([{ quantity: null, subUnit: STAEBCHEN }]);
    expect(totals).toEqual([
      { quantity: null, subUnitId: 10, subUnitName: "Stäbchen" },
    ]);
  });
});

describe("ceilToWhole", () => {
  it("rounds up fractional amounts (buy whole packs)", () => {
    expect(ceilToWhole(1.375)).toBe(2);
    expect(ceilToWhole(0.5)).toBe(1);
  });

  it("does not bump an exact multiple despite float noise", () => {
    expect(ceilToWhole(1.9999999998)).toBe(2);
    expect(ceilToWhole(2)).toBe(2);
  });
});
