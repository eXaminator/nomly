import { describe, it, expect } from "vitest";

import {
  resolveAmountInput,
  type AmountQuantifier,
} from "@/components/recipes/payload";

// A tiny fixture mirroring the GET /api/v1/quantifiers payload shape: a few
// quantifiers with canonical name, optional numeric value, and aliases.
const QUANTIFIERS: AmountQuantifier[] = [
  { id: 1, name: "ein", value: 1, aliases: ["eine", "one", "a", "an"] },
  { id: 2, name: "zwei", value: 2, aliases: ["two"] },
  { id: 10, name: "einige", value: null, aliases: ["several"] },
  { id: 11, name: "ein paar", value: null, aliases: ["a few", "a couple"] },
];

describe("resolveAmountInput", () => {
  it("treats a plain integer as a numeric quantity", () => {
    expect(resolveAmountInput("2", QUANTIFIERS)).toEqual({
      quantity: "2",
      quantifierId: null,
      valid: true,
    });
  });

  it("accepts a German decimal comma as numeric", () => {
    expect(resolveAmountInput("2,5", QUANTIFIERS)).toEqual({
      quantity: "2,5",
      quantifierId: null,
      valid: true,
    });
  });

  it("accepts a dot decimal as numeric", () => {
    expect(resolveAmountInput("2.5", QUANTIFIERS)).toEqual({
      quantity: "2.5",
      quantifierId: null,
      valid: true,
    });
  });

  it("resolves a known quantifier by canonical name", () => {
    expect(resolveAmountInput("einige", QUANTIFIERS)).toEqual({
      quantity: "",
      quantifierId: 10,
      valid: true,
    });
  });

  it("resolves a known quantifier case-insensitively", () => {
    expect(resolveAmountInput("ZWEI", QUANTIFIERS)).toEqual({
      quantity: "",
      quantifierId: 2,
      valid: true,
    });
  });

  it("resolves a known quantifier by alias", () => {
    expect(resolveAmountInput("a few", QUANTIFIERS)).toEqual({
      quantity: "",
      quantifierId: 11,
      valid: true,
    });
  });

  it("resolves a multi-word quantifier with surrounding whitespace", () => {
    expect(resolveAmountInput("  ein paar  ", QUANTIFIERS)).toEqual({
      quantity: "",
      quantifierId: 11,
      valid: true,
    });
  });

  it("marks a non-numeric, non-quantifier string invalid", () => {
    expect(resolveAmountInput("bogus", QUANTIFIERS)).toEqual({
      quantity: "",
      quantifierId: null,
      valid: false,
    });
  });

  it("treats an empty string as valid with no amount", () => {
    expect(resolveAmountInput("", QUANTIFIERS)).toEqual({
      quantity: "",
      quantifierId: null,
      valid: true,
    });
    expect(resolveAmountInput("   ", QUANTIFIERS)).toEqual({
      quantity: "",
      quantifierId: null,
      valid: true,
    });
  });

  it("prefers a numeric reading over a quantifier (numbers win)", () => {
    // A digit string is always numeric, never matched against quantifier names.
    expect(resolveAmountInput("1", QUANTIFIERS)).toEqual({
      quantity: "1",
      quantifierId: null,
      valid: true,
    });
  });
});
