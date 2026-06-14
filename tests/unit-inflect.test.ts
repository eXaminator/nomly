import { describe, it, expect } from "vitest";
import { buildUnitInflector } from "@/components/recipes/unit-inflect";
import type { UnitForm } from "@/lib/recipes/reparse-scan";

const FORMS: UnitForm[] = [
  { id: 1, name: "g", plural: null, aliases: [] },
  {
    id: 2,
    name: "Zehe",
    plural: "Zehen",
    aliases: [{ name: "clove", plural: "cloves" }],
  },
];

describe("buildUnitInflector", () => {
  const inflect = buildUnitInflector(FORMS);

  it("plural for >1 or unspecified (null); singular for exactly 1 and partials below 1", () => {
    expect(inflect("Zehe", 2)).toBe("Zehen");
    expect(inflect("Zehe", 1.5)).toBe("Zehen");
    expect(inflect("Zehe", 1)).toBe("Zehe");
    // Unspecified amount ("einige Zehen") reads as plural.
    expect(inflect("Zehe", null)).toBe("Zehen");
    // A partial amount below 1 ("0,5 Zehe") takes the singular.
    expect(inflect("Zehe", 0.5)).toBe("Zehe");
  });

  it("normalises a plural input back to the quantity-correct form", () => {
    // A label that arrives already pluralised (e.g. a legacy stored 'Zehen')
    // still resolves by quantity.
    expect(inflect("Zehen", 1)).toBe("Zehe");
    expect(inflect("Zehen", 3)).toBe("Zehen");
  });

  it("inflects an alias by its own plural", () => {
    expect(inflect("clove", 2)).toBe("cloves");
    expect(inflect("clove", 1)).toBe("clove");
    expect(inflect("cloves", 1)).toBe("clove");
  });

  it("leaves a unit without a plural unchanged", () => {
    expect(inflect("g", 2)).toBe("g");
    expect(inflect("g", 1)).toBe("g");
  });

  it("returns free text the catalogue doesn't know verbatim", () => {
    expect(inflect("Schuss", 2)).toBe("Schuss");
    expect(inflect("Schuss", 1)).toBe("Schuss");
  });

  it("returns null for a null label", () => {
    expect(inflect(null, 2)).toBeNull();
  });

  it("collapses a singular/plural difference but keeps an alias difference", () => {
    // The diff compares inflect(label, qty) on both sides at the same quantity:
    // pure singular-vs-plural collapses (no highlight); a real alias differs.
    expect(inflect("Zehe", 2)).toBe(inflect("Zehen", 2)); // → no highlight
    expect(inflect("clove", 2)).not.toBe(inflect("Zehe", 2)); // → highlight
  });
});
