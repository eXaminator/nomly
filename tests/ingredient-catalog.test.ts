import { describe, it, expect } from "vitest";
import {
  loadIngredientCatalog,
  findAliasCollisions,
  type CatalogEntry,
} from "@/lib/catalog/ingredient-catalog";

describe("loadIngredientCatalog", () => {
  it("returns the full hand-edited catalog (no warnings)", () => {
    const { entries, warnings } = loadIngredientCatalog();
    expect(warnings).toEqual([]);
    expect(entries.length).toBeGreaterThan(700);
  });

  it("exposes a stable mix of curated + auto-imported entries", () => {
    const { entries } = loadIngredientCatalog();
    // Every entry has a non-empty canonical and aliases array (possibly empty
    // list for newly-auto-imported rows). Canonicals are globally unique
    // (case-insensitive) — duplicates would point to the same DB row on seed.
    const canonicalLowers = entries.map((e) => e.canonicalName.toLowerCase());
    expect(new Set(canonicalLowers).size).toBe(entries.length);
  });

  it("exposes the Ei entry with eggs/Eier plural aliases", () => {
    const { entries } = loadIngredientCatalog();
    const ei = entries.find((e) => e.canonicalName === "Ei");
    expect(ei).toBeDefined();
    expect(ei!.aliases).toContain("eggs");
    expect(ei!.aliases).toContain("Eier");
  });

  it("exposes a single Champignon canonical with brown + white variant aliases", () => {
    const { entries } = loadIngredientCatalog();
    const names = entries.map((e) => e.canonicalName);
    expect(names).toContain("Champignon");
    expect(names).not.toContain("Champignon, weiß");
    expect(names).not.toContain("Champignon, braun");
    const champignon = entries.find((e) => e.canonicalName === "Champignon")!;
    expect(champignon.aliases).toContain("Champignons");
    expect(champignon.aliases).toContain("braune Champignons");
  });
});

describe("findAliasCollisions", () => {
  it("returns no collisions for the real catalog", () => {
    const { entries } = loadIngredientCatalog();
    expect(findAliasCollisions(entries)).toEqual([]);
  });

  it("detects an alias claimed by two synthetic entries (case-insensitive)", () => {
    const stub = (name: string, aliases: string[]): CatalogEntry => ({
      section: "test",
      canonicalName: name,
      category: "Fleisch",
      dietary: "meat",
      equipment: false,
      aliases,
      purchaseUnit: null,
      subUnit: null,
      subUnitAliases: [],
      notes: null,
    });
    const entries = [
      stub("Hackfleisch", ["Ground Beef"]),
      stub("Rinderhack", ["ground beef"]),
    ];
    const collisions = findAliasCollisions(entries);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].alias).toBe("ground beef");
    expect(collisions[0].canonicals.sort()).toEqual(["Hackfleisch", "Rinderhack"]);
  });

  it("treats subUnitAliases as colliding with regular aliases", () => {
    const stub = (
      name: string,
      aliases: string[],
      subUnitAliases: string[],
    ): CatalogEntry => ({
      section: "test",
      canonicalName: name,
      category: "Obst und Gemüse",
      dietary: "vegan",
      equipment: false,
      aliases,
      purchaseUnit: null,
      subUnit: subUnitAliases.length > 0 ? { name: "Scheibe", perPurchase: 1 } : null,
      subUnitAliases,
      notes: null,
    });
    const entries = [
      stub("Apfel", [], ["apple slice"]),
      stub("Birne", ["apple slice"], []),
    ];
    const collisions = findAliasCollisions(entries);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].alias).toBe("apple slice");
  });
});
