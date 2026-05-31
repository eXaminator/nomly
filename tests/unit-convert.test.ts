import { describe, it, expect } from "vitest";
import {
  aggregateContributions,
  type ConversionEdge,
  type UnitInfo,
} from "@/lib/units/convert";

// A small global unit catalogue: g (mass base), ml (volume base), TL = 5 ml,
// kg = 1000 g, plus count units Stange / Packung / Glas / Stück / Zehe.
function units(): Map<number, UnitInfo> {
  const list: UnitInfo[] = [
    { id: 1, name: "g", plural: null, dimension: "mass", baseUnitId: null, factor: 1 },
    { id: 2, name: "kg", plural: null, dimension: "mass", baseUnitId: 1, factor: 1000 },
    { id: 3, name: "ml", plural: null, dimension: "volume", baseUnitId: null, factor: 1 },
    { id: 4, name: "TL", plural: null, dimension: "volume", baseUnitId: 3, factor: 5 },
    { id: 5, name: "Stange", plural: "Stangen", dimension: "count", baseUnitId: null, factor: 1 },
    { id: 6, name: "Packung", plural: "Packungen", dimension: "count", baseUnitId: null, factor: 1 },
    { id: 7, name: "Glas", plural: "Gläser", dimension: "count", baseUnitId: null, factor: 1 },
    { id: 8, name: "Stück", plural: null, dimension: "count", baseUnitId: null, factor: 1 },
    { id: 9, name: "Zehe", plural: "Zehen", dimension: "count", baseUnitId: null, factor: 1 },
  ];
  return new Map(list.map((u) => [u.id, u]));
}
const G = 1, ML = 3, TL = 4, STANGE = 5, PACKUNG = 6, GLAS = 7, STUECK = 8, ZEHE = 9;

describe("aggregateContributions", () => {
  it("sums within one dimension and picks a sensible display unit", () => {
    const out = aggregateContributions(
      [{ unitId: G, quantity: 300 }, { unitId: G, quantity: 250 }],
      [],
      units(),
    );
    expect(out).toEqual([
      { unitId: G, unitName: "g", quantity: 550, dimension: "mass" },
    ]);
  });

  it("normalises a global edge (TL → ml) before summing", () => {
    const out = aggregateContributions(
      [{ unitId: TL, quantity: 2 }, { unitId: ML, quantity: 10 }],
      [],
      units(),
    );
    // 2 TL = 10 ml + 10 ml = 20 ml.
    expect(out).toEqual([
      { unitId: ML, unitName: "ml", quantity: 20, dimension: "volume" },
    ]);
  });

  it("crosses dimension via a per-ingredient density edge (ml → g)", () => {
    const edges: ConversionEdge[] = [
      { from: ML, to: G, factor: 0.5, isContainer: false },
    ];
    const out = aggregateContributions(
      [{ unitId: TL, quantity: 2 }, { unitId: G, quantity: 3 }],
      edges,
      units(),
    );
    // 2 TL = 10 ml = 5 g; + 3 g = 8 g. One component, base g.
    expect(out).toEqual([
      { unitId: G, unitName: "g", quantity: 8, dimension: "mass" },
    ]);
  });

  it("containerises the summed total and rounds up (buy whole packs)", () => {
    const edges: ConversionEdge[] = [
      { from: ML, to: G, factor: 0.5, isContainer: false },
      { from: GLAS, to: G, factor: 100, isContainer: true }, // 1 Glas = 100 g
    ];
    const out = aggregateContributions([{ unitId: G, quantity: 250 }], edges, units());
    // 250 g → ceil(250/100) = 3 Glas, with the summed base behind it.
    expect(out).toEqual([
      {
        unitId: GLAS,
        unitName: "Gläser",
        quantity: 3,
        dimension: "count",
        baseQuantity: 250,
        baseUnitName: "g",
      },
    ]);
  });

  it("normalises a direct container contribution back down, then re-containerises", () => {
    const edges: ConversionEdge[] = [
      { from: PACKUNG, to: STANGE, factor: 4, isContainer: true }, // 1 Packung = 4 Stangen
    ];
    const out = aggregateContributions(
      [{ unitId: STANGE, quantity: 2 }, { unitId: PACKUNG, quantity: 1 }],
      edges,
      units(),
    );
    // 2 Stangen + 1 Packung(=4 Stangen) = 6 Stangen → ceil(6/4) = 2 Packungen.
    expect(out).toEqual([
      {
        unitId: PACKUNG,
        unitName: "Packungen",
        quantity: 2,
        dimension: "count",
        baseQuantity: 6,
        baseUnitName: "Stangen",
      },
    ]);
  });

  it("keeps disconnected components as separate lines (Glas + Packung)", () => {
    const edges: ConversionEdge[] = [
      { from: ML, to: G, factor: 0.5, isContainer: false },
      { from: GLAS, to: G, factor: 100, isContainer: true },
      { from: PACKUNG, to: STANGE, factor: 4, isContainer: true },
    ];
    const out = aggregateContributions(
      [{ unitId: G, quantity: 100 }, { unitId: STANGE, quantity: 2 }],
      edges,
      units(),
    );
    // 100 g → ceil(100/100) = 1 Glas; 2 Stangen → ceil(2/4) = 1 Packung.
    // Both qty 1 → singular names. Separate components → separate lines.
    const byName = Object.fromEntries(out.map((a) => [a.unitName, a.quantity]));
    expect(byName).toEqual({ Glas: 1, Packung: 1 });
  });

  it("leaves an unconverted unit as its own standalone line, pluralised", () => {
    const out = aggregateContributions(
      [{ unitId: STANGE, quantity: 2 }],
      [],
      units(),
    );
    expect(out).toEqual([
      { unitId: STANGE, unitName: "Stangen", quantity: 2, dimension: "count" },
    ]);
  });

  it("counts: 12 Zehen with '1 Stück = 10 Zehen' → 2 Stück (ceil)", () => {
    const edges: ConversionEdge[] = [
      { from: STUECK, to: ZEHE, factor: 10, isContainer: true },
    ];
    const out = aggregateContributions([{ unitId: ZEHE, quantity: 12 }], edges, units());
    expect(out).toEqual([
      {
        unitId: STUECK,
        unitName: "Stück",
        quantity: 2,
        dimension: "count",
        baseQuantity: 12,
        baseUnitName: "Zehen",
      },
    ]);
  });

  it("open-ended (null quantity) contributions keep the unit but no total", () => {
    const out = aggregateContributions(
      [{ unitId: G, quantity: null }],
      [],
      units(),
    );
    expect(out).toEqual([
      { unitId: G, unitName: "g", quantity: null, dimension: "mass" },
    ]);
  });
});

describe("aggregateContributions — stock subtraction", () => {
  it("subtracts stock within the same dimension", () => {
    const out = aggregateContributions(
      [{ unitId: G, quantity: 250 }],
      [],
      units(),
      [{ unitId: G, quantity: 100 }],
    );
    expect(out).toEqual([
      { unitId: G, unitName: "g", quantity: 150, dimension: "mass" },
    ]);
  });

  it("clamps the remainder at zero when stock exceeds the total", () => {
    const out = aggregateContributions(
      [{ unitId: G, quantity: 100 }],
      [],
      units(),
      [{ unitId: G, quantity: 250 }],
    );
    expect(out).toEqual([
      { unitId: G, unitName: "g", quantity: 0, dimension: "mass" },
    ]);
  });

  it("subtracts before containerising (buy whole packs of the remainder)", () => {
    const edges: ConversionEdge[] = [
      { from: GLAS, to: G, factor: 100, isContainer: true }, // 1 Glas = 100 g
    ];
    const out = aggregateContributions(
      [{ unitId: G, quantity: 250 }],
      edges,
      units(),
      [{ unitId: G, quantity: 100 }],
    );
    // (250 - 100) = 150 g → ceil(150/100) = 2 Gläser, base 150.
    expect(out).toEqual([
      {
        unitId: GLAS,
        unitName: "Gläser",
        quantity: 2,
        dimension: "count",
        baseQuantity: 150,
        baseUnitName: "g",
      },
    ]);
  });

  it("normalises the stock unit (kg) before subtracting", () => {
    const out = aggregateContributions(
      [{ unitId: G, quantity: 1500 }],
      [],
      units(),
      [{ unitId: 2 /* kg */, quantity: 1 }],
    );
    // 1500 g - 1 kg(=1000 g) = 500 g.
    expect(out).toEqual([
      { unitId: G, unitName: "g", quantity: 500, dimension: "mass" },
    ]);
  });

  it("ignores cross-dimension stock (no phantom line, no effect)", () => {
    const out = aggregateContributions(
      [{ unitId: G, quantity: 200 }],
      [],
      units(),
      [{ unitId: STUECK, quantity: 5 }],
    );
    expect(out).toEqual([
      { unitId: G, unitName: "g", quantity: 200, dimension: "mass" },
    ]);
  });

  it("emits no line for a stock-only component", () => {
    const out = aggregateContributions([], [], units(), [
      { unitId: G, quantity: 100 },
    ]);
    expect(out).toEqual([]);
  });

  it("does not subtract from an open-ended (null) total", () => {
    const out = aggregateContributions(
      [{ unitId: G, quantity: null }],
      [],
      units(),
      [{ unitId: G, quantity: 50 }],
    );
    expect(out).toEqual([
      { unitId: G, unitName: "g", quantity: null, dimension: "mass" },
    ]);
  });
});
