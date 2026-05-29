import { describe, it, expect } from "vitest";
import {
  groupSubUnitTotals,
  rollupPurchaseTrack,
  type SubUnitRef,
} from "@/lib/shopping/subunit-rollup";
import type { UnitRow } from "@/lib/shopping/format";

const PACKUNG: UnitRow = {
  id: 1,
  name: "Packung",
  dimension: "count",
  baseUnitId: null,
  factor: 1,
};
const STAEBCHEN: SubUnitRef = { id: 10, name: "Stäbchen", perPurchase: 16 };
const SCHEIBEN: SubUnitRef = { id: 11, name: "Scheiben", perPurchase: 8 };

describe("rollupPurchaseTrack", () => {
  it("sums one sub-unit and rounds up to whole purchase units", () => {
    // 5 + 17 = 22 Stäbchen ÷ 16 = 1.375 → 2 Packung
    const rolled = rollupPurchaseTrack(
      [
        { quantity: 5, subUnit: STAEBCHEN },
        { quantity: 17, subUnit: STAEBCHEN },
      ],
      PACKUNG,
    );
    expect(rolled.quantity).toBe(2);
    expect(rolled.unitId).toBe(PACKUNG.id);
    expect(rolled.unitName).toBe("Packung");
    expect(rolled.dimension).toBe("count");
  });

  it("does not bump on an exact multiple", () => {
    // 32 Stäbchen ÷ 16 = 2.0 exactly → 2 (not 3)
    const rolled = rollupPurchaseTrack(
      [{ quantity: 32, subUnit: STAEBCHEN }],
      PACKUNG,
    );
    expect(rolled.quantity).toBe(2);
  });

  it("combines multiple sub-units that share one purchase unit", () => {
    // 8 Stäbchen (8/16 = 0.5) + 8 Scheiben (8/8 = 1.0) = 1.5 → 2 Packung
    const rolled = rollupPurchaseTrack(
      [
        { quantity: 8, subUnit: STAEBCHEN },
        { quantity: 8, subUnit: SCHEIBEN },
      ],
      PACKUNG,
    );
    expect(rolled.quantity).toBe(2);
  });

  it("folds a direct purchase-unit contribution into the same total", () => {
    // 1 Packung (1.0) + 8 Stäbchen (0.5) = 1.5 → 2 Packung
    const rolled = rollupPurchaseTrack(
      [
        { quantity: 1, subUnit: null },
        { quantity: 8, subUnit: STAEBCHEN },
      ],
      PACKUNG,
    );
    expect(rolled.quantity).toBe(2);
  });

  it("returns a null quantity (unit only) when every contribution is open-ended", () => {
    const rolled = rollupPurchaseTrack(
      [{ quantity: null, subUnit: STAEBCHEN }],
      PACKUNG,
    );
    expect(rolled.quantity).toBeNull();
    expect(rolled.unitName).toBe("Packung");
  });
});

describe("groupSubUnitTotals", () => {
  it("sums each sub-unit on its own, preserving first-seen order", () => {
    const totals = groupSubUnitTotals([
      { quantity: 5, subUnit: STAEBCHEN },
      { quantity: 3, subUnit: SCHEIBEN },
      { quantity: 17, subUnit: STAEBCHEN },
    ]);
    expect(totals).toEqual([
      { quantity: 22, subUnitId: 10, subUnitName: "Stäbchen" },
      { quantity: 3, subUnitId: 11, subUnitName: "Scheiben" },
    ]);
  });

  it("yields a null quantity when a sub-unit's contributions are all open-ended", () => {
    const totals = groupSubUnitTotals([
      { quantity: null, subUnit: STAEBCHEN },
    ]);
    expect(totals).toEqual([
      { quantity: null, subUnitId: 10, subUnitName: "Stäbchen" },
    ]);
  });
});
