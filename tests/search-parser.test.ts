import { describe, it, expect } from "vitest";
import { parseQuery, fold } from "@/lib/recipes/search";

describe("fold", () => {
  it("lowercases and strips diacritics", () => {
    expect(fold("Möhre")).toBe("mohre");
    expect(fold("Äpfel")).toBe("apfel");
  });
  it("replaces ß with ss", () => {
    expect(fold("Straße")).toBe("strasse");
  });
});

describe("parseQuery", () => {
  it("returns empty tokens for empty/whitespace input", () => {
    expect(parseQuery("")).toEqual({ tokens: [] });
    expect(parseQuery("   ")).toEqual({ tokens: [] });
  });

  it("splits unprefixed tokens on whitespace", () => {
    expect(parseQuery("tomate basilikum")).toEqual({
      tokens: [
        { kind: "title", text: "tomate", isPhrase: false, polarity: "include" },
        { kind: "title", text: "basilikum", isPhrase: false, polarity: "include" },
      ],
    });
  });

  it("folds tokens (diacritics, ß, case)", () => {
    expect(parseQuery("Möhre Straße")).toEqual({
      tokens: [
        { kind: "title", text: "mohre", isPhrase: false, polarity: "include" },
        { kind: "title", text: "strasse", isPhrase: false, polarity: "include" },
      ],
    });
  });

  it("treats quoted spans as a single phrase token", () => {
    expect(parseQuery('"rote linsen"')).toEqual({
      tokens: [
        { kind: "title", text: "rote linsen", isPhrase: true, polarity: "include" },
      ],
    });
  });

  it("handles an unterminated quote as if closed at end of input", () => {
    expect(parseQuery('"rote linsen')).toEqual({
      tokens: [
        { kind: "title", text: "rote linsen", isPhrase: true, polarity: "include" },
      ],
    });
  });

  it("supports + and - polarity prefixes", () => {
    expect(parseQuery("+pasta -nudeln")).toEqual({
      tokens: [
        { kind: "title", text: "pasta", isPhrase: false, polarity: "include" },
        { kind: "title", text: "nudeln", isPhrase: false, polarity: "exclude" },
      ],
    });
  });

  it("supports zutat: field prefix (case-insensitive)", () => {
    expect(parseQuery("ZUTAT:Basilikum")).toEqual({
      tokens: [
        { kind: "zutat", text: "basilikum", isPhrase: false, polarity: "include" },
      ],
    });
  });

  it("supports zutat: with quoted phrase", () => {
    expect(parseQuery('zutat:"rote linsen"')).toEqual({
      tokens: [
        { kind: "zutat", text: "rote linsen", isPhrase: true, polarity: "include" },
      ],
    });
  });

  it("supports -zutat: exclusion", () => {
    expect(parseQuery("-zutat:fleisch")).toEqual({
      tokens: [
        { kind: "zutat", text: "fleisch", isPhrase: false, polarity: "exclude" },
      ],
    });
  });

  it("drops empty tokens after stripping", () => {
    expect(parseQuery('- "" zutat: pasta')).toEqual({
      tokens: [
        { kind: "title", text: "pasta", isPhrase: false, polarity: "include" },
      ],
    });
  });

  it("mixes everything together", () => {
    const result = parseQuery(
      'pasta "rote linsen" +tomate -nudeln zutat:basilikum -zutat:fleisch',
    );
    expect(result.tokens).toEqual([
      { kind: "title", text: "pasta", isPhrase: false, polarity: "include" },
      { kind: "title", text: "rote linsen", isPhrase: true, polarity: "include" },
      { kind: "title", text: "tomate", isPhrase: false, polarity: "include" },
      { kind: "title", text: "nudeln", isPhrase: false, polarity: "exclude" },
      { kind: "zutat", text: "basilikum", isPhrase: false, polarity: "include" },
      { kind: "zutat", text: "fleisch", isPhrase: false, polarity: "exclude" },
    ]);
  });
});
