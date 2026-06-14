import { describe, it, expect } from "vitest";
import { parseIngredientLines, type ParseLookups } from "@/lib/recipe-import";

// A focused corpus of the split/guard cases the entity-first Phase 2 refactor
// touches. Each line is parsed with the SAME empty-catalog lookups the unit
// tests use, so the snapshot pins the descriptor/color/headless behavior that
// must survive the refactor (the parity oracle for the connector-split change).
const LINES = [
  "Salz und Pfeffer",
  "Salz & Pfeffer",
  "Salt and Pepper",
  "2 cups mixed yellow and red grape tomatoes (halved)",
  "gelbe und rote Paprika",
  "6 dried or fresh shiitake mushrooms",
  "200 g Weizen- oder Dinkelmehl",
  "100 g Mehl und Zucker",
  "Honig oder Ahornsirup",
  "20 oz. fresh or frozen cheese tortellini",
];

const EMPTY_LOOKUPS: ParseLookups = {
  units: {
    byNameOrAlias: new Map(),
    byCanonicalName: new Map(),
    byId: new Map(),
    containerTokens: new Set(),
    unspecificTokens: new Set(),
    maxUnitTokens: 1,
    globalDefaultUnitId: null,
  },
  ingredients: new Map(),
  ingredientCatalog: [],
};

describe("parser parity corpus (Phase 2 guard cases)", () => {
  for (const line of LINES) {
    it(`parity: ${line}`, () => {
      const rows = parseIngredientLines([line], EMPTY_LOOKUPS).map((r) => ({
        name: r.name,
        quantity: r.quantity,
        unit: r.unit?.name ?? r.rawUnit ?? null,
        notes: r.notes,
        isAlternative: r.isAlternative,
      }));
      expect(rows).toMatchSnapshot();
    });
  }
});
