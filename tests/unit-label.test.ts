import { describe, expect, it } from "vitest";
import {
  pluralizeLabel,
  resolveUnitLabel,
  type UnitLabelInfo,
} from "@/lib/units/label";

const dose: UnitLabelInfo = {
  name: "Dose",
  plural: "Dosen",
  aliases: [
    { name: "can", plural: "cans" },
    { name: "tin", plural: null },
  ],
};

const el: UnitLabelInfo = {
  name: "EL",
  plural: null,
  aliases: [{ name: "tablespoon", plural: "tablespoons" }],
};

describe("pluralizeLabel", () => {
  it("uses the singular for exactly 1", () => {
    expect(pluralizeLabel({ name: "Dose", plural: "Dosen" }, 1)).toBe("Dose");
  });

  it("uses the plural for any amount other than 1", () => {
    expect(pluralizeLabel({ name: "Dose", plural: "Dosen" }, 2)).toBe("Dosen");
    expect(pluralizeLabel({ name: "Dose", plural: "Dosen" }, 0.5)).toBe("Dosen");
    expect(pluralizeLabel({ name: "Dose", plural: "Dosen" }, 0)).toBe("Dosen");
  });

  it("falls back to the singular when no plural is configured", () => {
    expect(pluralizeLabel({ name: "g", plural: null }, 500)).toBe("g");
  });

  it("uses the singular when quantity is null", () => {
    expect(pluralizeLabel({ name: "Dose", plural: "Dosen" }, null)).toBe("Dose");
  });
});

describe("resolveUnitLabel — canonical unit", () => {
  it("uses the canonical plural when no displayUnit override is present", () => {
    expect(
      resolveUnitLabel({ unit: dose, displayUnit: null, quantity: 3 }),
    ).toBe("Dosen");
    expect(
      resolveUnitLabel({ unit: dose, displayUnit: null, quantity: 1 }),
    ).toBe("Dose");
  });

  it("pluralizes a displayUnit that equals the canonical singular", () => {
    expect(
      resolveUnitLabel({ unit: dose, displayUnit: "Dose", quantity: 4 }),
    ).toBe("Dosen");
  });

  it("renders the singular for a displayUnit stored as the canonical plural", () => {
    // Import preserved "Dosen" verbatim, but the amount is 1 → singular wins.
    expect(
      resolveUnitLabel({ unit: dose, displayUnit: "Dosen", quantity: 1 }),
    ).toBe("Dose");
  });
});

describe("resolveUnitLabel — matched alias drives display", () => {
  it("uses the matched alias's plural, not the canonical", () => {
    expect(
      resolveUnitLabel({
        unit: el,
       
        displayUnit: "tablespoon",
        quantity: 3,
      }),
    ).toBe("tablespoons");
  });

  it("matches an alias by its plural spelling and still picks the right form", () => {
    expect(
      resolveUnitLabel({
        unit: el,
       
        displayUnit: "tablespoons",
        quantity: 1,
      }),
    ).toBe("tablespoon");
  });

  it("falls back to the alias singular when that alias has no plural", () => {
    expect(
      resolveUnitLabel({ unit: dose, displayUnit: "tin", quantity: 6 }),
    ).toBe("tin");
  });
});

describe("resolveUnitLabel — fallbacks", () => {
  it("shows unresolvable free text verbatim regardless of amount", () => {
    expect(
      resolveUnitLabel({ unit: dose, displayUnit: "Schuss", quantity: 5 }),
    ).toBe("Schuss");
  });

  it("returns null when there is no unit, sub-unit, or displayUnit", () => {
    expect(
      resolveUnitLabel({ unit: null, displayUnit: null, quantity: 2 }),
    ).toBeNull();
  });

  it("matching is case-insensitive", () => {
    expect(
      resolveUnitLabel({ unit: dose, displayUnit: "dose", quantity: 2 }),
    ).toBe("Dosen");
  });
});
