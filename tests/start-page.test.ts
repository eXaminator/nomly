import { describe, expect, it } from "vitest";
import { resolveStartPage, START_PAGE_KEY, START_PAGE_OPTIONS } from "@/lib/start-page";

describe("resolveStartPage", () => {
  it("accepts every allow-listed page", () => {
    for (const o of START_PAGE_OPTIONS) {
      expect(resolveStartPage(o.value)).toBe(o.value);
    }
  });

  it("falls back to the dashboard for anything else", () => {
    expect(resolveStartPage(null)).toBe("/");
    expect(resolveStartPage(undefined)).toBe("/");
    expect(resolveStartPage("")).toBe("/");
    expect(resolveStartPage("/admin")).toBe("/");
    expect(resolveStartPage("https://evil.example/")).toBe("/");
    expect(resolveStartPage(42)).toBe("/");
  });

  it("offers dashboard, einkauf, plan and rezepte", () => {
    expect(START_PAGE_OPTIONS.map((o) => o.value)).toEqual(["/", "/einkauf", "/plan", "/rezepte"]);
  });

  it("uses a stable storage key", () => {
    expect(START_PAGE_KEY).toBe("nomly.startPage");
  });
});
