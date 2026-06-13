import { describe, expect, it } from "vitest";
import { aggregateContributions, type UnitInfo } from "@/lib/units/convert";

/**
 * Unspecific units take no amount: their contributions carry a non-null unitId
 * but a null quantity, and they never connect to other units (no baseUnitId, no
 * conversion edges). The aggregation must therefore collapse duplicate
 * contributions of the same ingredient + unspecific unit into a SINGLE
 * null-quantity line — the "collapse to one entry" shopping-list decision.
 */
describe("unspecific unit aggregation", () => {
  const etwas: UnitInfo = {
    id: 50,
    name: "etwas",
    plural: null,
    dimension: "count",
    baseUnitId: null,
    factor: 1,
  };
  const ml: UnitInfo = {
    id: 7,
    name: "ml",
    plural: null,
    dimension: "volume",
    baseUnitId: null,
    factor: 1,
  };
  const units = new Map<number, UnitInfo>([
    [etwas.id, etwas],
    [ml.id, ml],
  ]);

  it("collapses two unspecific contributions into one null-quantity line", () => {
    const lines = aggregateContributions(
      [
        { unitId: 50, quantity: null },
        { unitId: 50, quantity: null },
      ],
      [],
      units,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].unitId).toBe(50);
    expect(lines[0].quantity).toBeNull();
    expect(lines[0].unitName).toBe("etwas");
  });

  it("keeps an unspecific and a dimensional contribution as separate lines", () => {
    const lines = aggregateContributions(
      [
        { unitId: 50, quantity: null },
        { unitId: 7, quantity: 200 },
      ],
      [],
      units,
    );
    expect(lines).toHaveLength(2);
    const etwasLine = lines.find((l) => l.unitId === 50)!;
    const mlLine = lines.find((l) => l.unitId === 7)!;
    expect(etwasLine.quantity).toBeNull();
    expect(mlLine.quantity).toBe(200);
  });
});
