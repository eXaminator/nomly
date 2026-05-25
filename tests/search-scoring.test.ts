import { describe, it, expect } from "vitest";
import { scoreToken, matchRecipe, parseQuery } from "@/lib/recipes/search";

describe("scoreToken", () => {
  const tok = (text: string, isPhrase = false) =>
    ({
      kind: "title" as const,
      text,
      isPhrase,
      polarity: "include" as const,
    });

  it("exact equality → 100", () => {
    expect(scoreToken(tok("tomate"), "tomate")).toBe(100);
  });

  it("prefix match → 80", () => {
    expect(scoreToken(tok("toma"), "tomatensuppe")).toBe(80);
  });

  it("substring after a non-letter char → 60 (e.g. thai-basilikum)", () => {
    expect(scoreToken(tok("basilikum"), "thai-basilikum")).toBe(60);
  });

  it("substring at word end → 60 (German compound: suppe ↔ tomatensuppe)", () => {
    expect(scoreToken(tok("suppe"), "tomatensuppe")).toBe(60);
  });

  it("mid-word substring does NOT match (e.g. reis ↛ preiselbeere)", () => {
    expect(scoreToken(tok("reis"), "preiselbeere")).toBe(0);
  });

  it("Levenshtein within threshold → 40 minus 5×distance", () => {
    expect(scoreToken(tok("tomte"), "tomate")).toBe(35);
  });

  it("Levenshtein beyond threshold → 0", () => {
    expect(scoreToken(tok("xyz"), "tomate")).toBe(0);
  });

  it("multi-word field uses max-per-word", () => {
    expect(scoreToken(tok("basilikum"), "tomate basilikum salz")).toBe(100);
    expect(scoreToken(tok("bas"), "tomate basilikum salz")).toBe(80);
  });

  it("phrase → 80 on contiguous substring of full field", () => {
    expect(
      scoreToken(tok("rote linsen", true), "suppe mit rote linsen und reis"),
    ).toBe(80);
  });

  it("phrase → 0 when not contiguous", () => {
    expect(scoreToken(tok("rote linsen", true), "rote suppe mit linsen")).toBe(
      0,
    );
  });
});

describe("matchRecipe", () => {
  const rec = (title: string, ingredients = "") => ({
    titleFolded: title,
    ingredientsFolded: ingredients,
  });

  it("empty query matches every recipe with rank 0", () => {
    expect(matchRecipe(parseQuery(""), rec("tomatensuppe"))).toEqual({
      passes: true,
      rank: 0,
    });
  });

  it("AND across include tokens", () => {
    const r = matchRecipe(parseQuery("tomate suppe"), rec("tomatensuppe"));
    expect(r.passes).toBe(true);
    expect(r.rank).toBeGreaterThan(0);
  });

  it("AND fails when one token misses", () => {
    expect(
      matchRecipe(parseQuery("tomate pizza"), rec("tomatensuppe")).passes,
    ).toBe(false);
  });

  it("exclude token vetoes the recipe", () => {
    expect(
      matchRecipe(parseQuery("tomate -suppe"), rec("tomatensuppe")).passes,
    ).toBe(false);
  });

  it("zutat: targets the ingredient field only", () => {
    const r = matchRecipe(
      parseQuery("zutat:basilikum"),
      rec("tomatensuppe", "basilikum tomate"),
    );
    expect(r.passes).toBe(true);
  });

  it("zutat: misses when only present in title", () => {
    expect(
      matchRecipe(parseQuery("zutat:tomate"), rec("tomatensuppe", "")).passes,
    ).toBe(false);
  });

  it("ASCII folding lets mohre match mohre (input was Möhre)", () => {
    expect(matchRecipe(parseQuery("mohre"), rec("mohrensuppe")).passes).toBe(
      true,
    );
  });
});
