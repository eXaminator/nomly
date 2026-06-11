import { describe, expect, it } from "vitest";
import { aliasDedupKey } from "@/lib/recipe-import/ast/candidate-tokens";
import { findAliasCollisions } from "@/components/settings/stammdaten/alias-collisions";

describe("aliasDedupKey", () => {
  it("folds case, diacritics, ß, separators and the und/&/and conjunction", () => {
    expect(aliasDedupKey("Plant-based meat")).toBe(aliasDedupKey("plant based meat"));
    expect(aliasDedupKey("Salz & Pfeffer")).toBe(aliasDedupKey("Salz und Pfeffer"));
    expect(aliasDedupKey("Salz und Pfeffer")).toBe(aliasDedupKey("salz and pfeffer"));
    expect(aliasDedupKey("Crème fraîche")).toBe(aliasDedupKey("creme fraiche"));
    expect(aliasDedupKey("Weißbrot")).toBe(aliasDedupKey("Weissbrot"));
  });

  it("does NOT fold genuinely different words (plural is not identical)", () => {
    expect(aliasDedupKey("Mandel")).not.toBe(aliasDedupKey("Mandeln"));
    expect(aliasDedupKey("Reis")).not.toBe(aliasDedupKey("Reise"));
  });

  it("is blank for empty / separator-only input", () => {
    expect(aliasDedupKey("")).toBe("");
    expect(aliasDedupKey("  - / ")).toBe("");
  });
});

describe("findAliasCollisions", () => {
  it("flags an alias virtually identical to the canonical name", () => {
    const c = findAliasCollisions("Plant-based meat", ["plant based meat", "Fleischersatz"]);
    expect(c.get(0)).toEqual({ collidesWith: "name" });
    expect(c.has(1)).toBe(false);
  });

  it("flags both aliases when two are virtually identical to each other", () => {
    const c = findAliasCollisions("Olivenöl", ["extra virgin", "Extra-Virgin"]);
    expect(c.get(0)).toEqual({ collidesWith: "alias" });
    expect(c.get(1)).toEqual({ collidesWith: "alias" });
  });

  it("does not flag distinct aliases", () => {
    const c = findAliasCollisions("Zucker", ["brauner Zucker", "Rohrzucker"]);
    expect(c.size).toBe(0);
  });

  it("ignores blank aliases", () => {
    const c = findAliasCollisions("Zucker", ["", "  "]);
    expect(c.size).toBe(0);
  });

  it("a name collision outranks an alias collision", () => {
    const c = findAliasCollisions("Zucker", ["zucker", "Zucker"]);
    expect(c.get(0)).toEqual({ collidesWith: "name" });
    expect(c.get(1)).toEqual({ collidesWith: "name" });
  });
});
