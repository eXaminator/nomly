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
    expect(parseQuery("").tokens).toEqual([]);
    expect(parseQuery("   ").tokens).toEqual([]);
  });

  it("splits unprefixed tokens on whitespace", () => {
    expect(parseQuery("tomate basilikum").tokens).toEqual([
      { kind: "title", text: "tomate", isPhrase: false, polarity: "include" },
      { kind: "title", text: "basilikum", isPhrase: false, polarity: "include" },
    ]);
  });

  it("folds tokens (diacritics, ß, case)", () => {
    expect(parseQuery("Möhre Straße").tokens).toEqual([
      { kind: "title", text: "mohre", isPhrase: false, polarity: "include" },
      { kind: "title", text: "strasse", isPhrase: false, polarity: "include" },
    ]);
  });

  it("treats quoted spans as a single phrase token", () => {
    expect(parseQuery('"rote linsen"').tokens).toEqual([
      { kind: "title", text: "rote linsen", isPhrase: true, polarity: "include" },
    ]);
  });

  it("handles an unterminated quote as if closed at end of input", () => {
    expect(parseQuery('"rote linsen').tokens).toEqual([
      { kind: "title", text: "rote linsen", isPhrase: true, polarity: "include" },
    ]);
  });

  it("supports + and - polarity prefixes", () => {
    expect(parseQuery("+pasta -nudeln").tokens).toEqual([
      { kind: "title", text: "pasta", isPhrase: false, polarity: "include" },
      { kind: "title", text: "nudeln", isPhrase: false, polarity: "exclude" },
    ]);
  });

  it("supports zutat: field prefix (case-insensitive)", () => {
    expect(parseQuery("ZUTAT:Basilikum").tokens).toEqual([
      { kind: "zutat", text: "basilikum", isPhrase: false, polarity: "include" },
    ]);
  });

  it("supports zutat: with quoted phrase", () => {
    expect(parseQuery('zutat:"rote linsen"').tokens).toEqual([
      { kind: "zutat", text: "rote linsen", isPhrase: true, polarity: "include" },
    ]);
  });

  it("supports -zutat: exclusion", () => {
    expect(parseQuery("-zutat:fleisch").tokens).toEqual([
      { kind: "zutat", text: "fleisch", isPhrase: false, polarity: "exclude" },
    ]);
  });

  it("drops empty tokens after stripping", () => {
    expect(parseQuery('- "" zutat: pasta').tokens).toEqual([
      { kind: "title", text: "pasta", isPhrase: false, polarity: "include" },
    ]);
  });

  it("uppercase OR groups two tokens into an OR-clause", () => {
    const r = parseQuery("tomate OR pasta");
    expect(r.tokens).toEqual([
      { kind: "title", text: "tomate", isPhrase: false, polarity: "include" },
      { kind: "title", text: "pasta", isPhrase: false, polarity: "include" },
    ]);
    expect(r.clauses).toEqual([
      {
        kind: "or",
        tokens: [
          { kind: "title", text: "tomate", isPhrase: false, polarity: "include" },
          { kind: "title", text: "pasta", isPhrase: false, polarity: "include" },
        ],
      },
    ]);
  });

  it("OR has higher precedence than the implicit AND", () => {
    const r = parseQuery("A B OR C D");
    expect(r.clauses).toEqual([
      {
        kind: "single",
        token: { kind: "title", text: "a", isPhrase: false, polarity: "include" },
      },
      {
        kind: "or",
        tokens: [
          { kind: "title", text: "b", isPhrase: false, polarity: "include" },
          { kind: "title", text: "c", isPhrase: false, polarity: "include" },
        ],
      },
      {
        kind: "single",
        token: { kind: "title", text: "d", isPhrase: false, polarity: "include" },
      },
    ]);
  });

  it("lowercase 'or' is treated as the OR keyword too", () => {
    const r = parseQuery("tomate or pasta");
    expect(r.clauses).toEqual([
      {
        kind: "or",
        tokens: [
          { kind: "title", text: "tomate", isPhrase: false, polarity: "include" },
          { kind: "title", text: "pasta", isPhrase: false, polarity: "include" },
        ],
      },
    ]);
  });

  it("quoted 'or' inside a phrase stays literal", () => {
    // The phrase is one whole token; the inner "or" is just letters.
    const r = parseQuery('"mit or ohne"');
    expect(r.tokens).toEqual([
      { kind: "title", text: "mit or ohne", isPhrase: true, polarity: "include" },
    ]);
    expect(r.clauses).toEqual([
      {
        kind: "single",
        token: { kind: "title", text: "mit or ohne", isPhrase: true, polarity: "include" },
      },
    ]);
  });

  it("trailing/leading/orphan OR is dropped", () => {
    expect(parseQuery("OR pasta").clauses).toEqual([
      {
        kind: "single",
        token: { kind: "title", text: "pasta", isPhrase: false, polarity: "include" },
      },
    ]);
    expect(parseQuery("pasta OR").clauses).toEqual([
      {
        kind: "single",
        token: { kind: "title", text: "pasta", isPhrase: false, polarity: "include" },
      },
    ]);
  });

  it("excluded tokens never join an OR-group", () => {
    const r = parseQuery("tomate OR -nudeln");
    expect(r.clauses).toEqual([
      {
        kind: "single",
        token: { kind: "title", text: "tomate", isPhrase: false, polarity: "include" },
      },
      {
        kind: "single",
        token: { kind: "title", text: "nudeln", isPhrase: false, polarity: "exclude" },
      },
    ]);
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
