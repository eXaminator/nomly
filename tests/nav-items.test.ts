import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isNavItemActive } from "@/components/layout/nav-items";

describe("nav items", () => {
  it("leads with the dashboard Start entry", () => {
    expect(NAV_ITEMS.map((i) => i.href)).toEqual([
      "/", "/rezepte", "/plan", "/einkauf", "/einstellungen",
    ]);
    expect(NAV_ITEMS[0].label).toBe("Start");
  });

  it("activates the Start entry only on the dashboard itself", () => {
    const start = NAV_ITEMS[0];
    expect(isNavItemActive(start, "/")).toBe(true);
    expect(isNavItemActive(start, "/rezepte")).toBe(false);
    expect(isNavItemActive(start, "/plan")).toBe(false);
    expect(isNavItemActive(start, "/offline")).toBe(false);
  });

  it("keeps prefix matching for section entries", () => {
    const rezepte = NAV_ITEMS.find((i) => i.href === "/rezepte")!;
    expect(isNavItemActive(rezepte, "/rezepte/42")).toBe(true);
    expect(isNavItemActive(rezepte, "/")).toBe(false);
  });
});
