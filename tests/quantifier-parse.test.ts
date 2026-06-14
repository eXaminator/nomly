/**
 * Task 2.1 — quantifier recognition in the per-segment parser.
 *
 * A quantifier is an amount-WORD ("einige", "zwei", "ein", "some"). When a
 * leading quantifier token wins the amount slot, the row carries quantifier
 * id/name and its numeric `value` becomes the (effective) quantity — `null`
 * for an unspecified quantifier ("einige"), in which case a unit that follows
 * is NOT defaulted to 1.
 *
 * Resolution rule (additive — inert without a quantifiers lookup):
 *  - a leading quantifier becomes the AMOUNT if it isn't a unit at all, OR it
 *    is a unit but ANOTHER unit token follows it;
 *  - if it is the only unit (no other unit follows), it stays a unit.
 */

import { describe, expect, it } from "vitest";
import {
  parseIngredientLines,
  type IngredientLookup,
  type ParseLookups,
  type QuantifierLookup,
  type QuantifierLookupEntry,
  type UnitLookup,
} from "@/lib/recipe-import";
import type { IngredientCatalog } from "@/lib/recipe-import/matching";

/** A quantifier lookup with: ein/a = 1, zwei = 2, einige = null, some = null. */
function makeQuantifiers(): QuantifierLookup {
  const entries: QuantifierLookupEntry[] = [
    { id: 1, name: "ein", value: 1 },
    { id: 2, name: "zwei", value: 2 },
    { id: 3, name: "einige", value: null },
    { id: 4, name: "some", value: null },
  ];
  const byNameOrAlias = new Map<string, QuantifierLookupEntry>();
  const byId = new Map<number, QuantifierLookupEntry>();
  for (const e of entries) {
    byNameOrAlias.set(e.name.toLowerCase(), e);
    byId.set(e.id, e);
  }
  // "a" is an alias of ein(1).
  byNameOrAlias.set("a", byId.get(1)!);
  let maxTokens = 1;
  for (const k of byNameOrAlias.keys()) {
    maxTokens = Math.max(maxTokens, k.trim().split(/\s+/).length);
  }
  return { byNameOrAlias, byId, maxTokens };
}

function makeLookups(
  catalog: IngredientCatalog,
  unitNames: readonly string[],
  unspecificUnits: readonly string[] = [],
): ParseLookups {
  // Unspecific units are real units flagged unspecific, so they live in the
  // unit lookup AND in unspecificTokens (mirrors production).
  const unitEntries = ["g", ...unitNames, ...unspecificUnits].map((name, i) => [
    name.toLowerCase(),
    { id: i + 1, name, isContainer: false },
  ] as const);
  const units: UnitLookup = {
    byNameOrAlias: new Map(unitEntries),
    byCanonicalName: new Map(unitEntries),
    byId: new Map(unitEntries.map(([, e]) => [e.id, e] as const)),
    containerTokens: new Set(),
    unspecificTokens: new Set(unspecificUnits.map((u) => u.toLowerCase())),
    maxUnitTokens: 1,
    globalDefaultUnitId: null,
  };
  const ingredients: IngredientLookup = new Map();
  for (const entry of catalog) {
    ingredients.set(entry.aliasName.toLowerCase(), {
      id: entry.ingredientId,
      canonicalName: entry.canonicalName,
    });
  }
  return {
    units,
    ingredients,
    ingredientCatalog: catalog,
    quantifiers: makeQuantifiers(),
  };
}

const cat = (...names: string[]): IngredientCatalog =>
  names.map((n, i) => ({
    ingredientId: i + 100,
    canonicalName: n,
    aliasName: n,
    tokens: [n.toLowerCase()],
  }));

describe("quantifier recognition — leading amount-word", () => {
  it("'einige Stiele Petersilie' → null quantity, quantifier 'einige', unit 'Stiele'", () => {
    const out = parseIngredientLines(
      ["einige Stiele Petersilie"],
      makeLookups(cat("Petersilie"), ["Stiel", "Stiele"]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBeNull();
    expect(out[0].quantifierName).toBe("einige");
    expect(out[0].quantifierId).toBe(3);
    expect(out[0].unit?.name).toBe("Stiele");
    expect(out[0].name).toBe("Petersilie");
  });

  it("'zwei Äpfel' → effective quantity 2, quantifier 'zwei', no unit", () => {
    const out = parseIngredientLines(
      ["zwei Äpfel"],
      makeLookups(cat("Äpfel"), []),
    );
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(2);
    expect(out[0].quantifierId).toBe(2);
    expect(out[0].quantifierName).toBe("zwei");
    expect(out[0].name).toBe("Äpfel");
  });

  it("'some sprigs basil' → 'some' wins (another unit 'sprigs' follows)", () => {
    // "some" is both an unspecific unit AND a quantifier; "sprigs" is the real
    // unit that follows, so the quantifier wins the amount slot.
    const out = parseIngredientLines(
      ["some sprigs basil"],
      makeLookups(cat("basil"), ["sprigs"], ["some"]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].quantifierName).toBe("some");
    expect(out[0].quantifierId).toBe(4);
    expect(out[0].quantity).toBeNull();
    expect(out[0].unit?.name).toBe("sprigs");
    expect(out[0].name).toBe("basil");
  });

  it("'some bananas' → 'some' is the ONLY unit, stays unit (quantifier NOT set)", () => {
    const out = parseIngredientLines(
      ["some bananas"],
      makeLookups(cat("bananas"), [], ["some"]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].quantifierName).toBeNull();
    expect(out[0].quantifierId).toBeNull();
    expect(out[0].unit?.name?.toLowerCase()).toBe("some");
    expect(out[0].name).toBe("bananas");
  });

  it("'a pinch of salt' → quantifier 'ein' (eff 1), unit 'pinch'", () => {
    const out = parseIngredientLines(
      ["a pinch of salt"],
      makeLookups(cat("salt"), ["pinch"]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].quantifierName).toBe("ein");
    expect(out[0].quantifierId).toBe(1);
    expect(out[0].quantity).toBe(1);
    expect(out[0].unit?.name).toBe("pinch");
    expect(out[0].name).toBe("salt");
  });
});
