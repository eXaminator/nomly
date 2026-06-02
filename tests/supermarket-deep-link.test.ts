import { describe, it, expect } from "vitest";
import { resolveSupermarketDeepLink } from "@/lib/shopping/supermarket-deep-link";

// Valid store ids for these cases: 1, 2, 3.
const isValid = (id: number) => [1, 2, 3].includes(id);

describe("resolveSupermarketDeepLink", () => {
  it("selects and persists a store from a valid id param", () => {
    expect(resolveSupermarketDeepLink("2", null, isValid)).toEqual({
      id: 2,
      storage: "write",
    });
  });

  it("resets and clears the default on ?supermarket=all", () => {
    expect(resolveSupermarketDeepLink("all", "2", isValid)).toEqual({
      id: null,
      storage: "clear",
    });
  });

  it("treats an empty param value as a reset", () => {
    expect(resolveSupermarketDeepLink("", "2", isValid)).toEqual({
      id: null,
      storage: "clear",
    });
  });

  it("ignores an unknown store id and falls back to the stored default", () => {
    expect(resolveSupermarketDeepLink("999", "3", isValid)).toEqual({
      id: 3,
      storage: "none",
    });
  });

  it("ignores a non-numeric param and falls back to the stored default", () => {
    expect(resolveSupermarketDeepLink("edeka", "1", isValid)).toEqual({
      id: 1,
      storage: "none",
    });
  });

  it("restores a valid stored default when no param is present", () => {
    expect(resolveSupermarketDeepLink(null, "3", isValid)).toEqual({
      id: 3,
      storage: "none",
    });
  });

  it("leaves the filter untouched with no param and no stored default", () => {
    expect(resolveSupermarketDeepLink(null, null, isValid)).toEqual({
      id: undefined,
      storage: "none",
    });
  });

  it("ignores a stale stored default that is no longer a valid store", () => {
    expect(resolveSupermarketDeepLink(null, "999", isValid)).toEqual({
      id: undefined,
      storage: "none",
    });
  });

  it("does not let a stale stored value block an explicit reset", () => {
    expect(resolveSupermarketDeepLink("all", "999", isValid)).toEqual({
      id: null,
      storage: "clear",
    });
  });
});
