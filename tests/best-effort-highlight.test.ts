import { describe, it, expect } from "vitest";
import { bestEffortNameHighlight } from "@/lib/recipe-import/ast/best-effort-highlight";

describe("bestEffortNameHighlight", () => {
  it("marks the name span when present in the line (boundary-aligned)", () => {
    const hl = bestEffortNameHighlight("Basilikum", "Oregano, Majoran und Basilikum");
    expect(hl).toEqual([{ kind: "name", range: [21, 30] }]);
  });

  it("is case-insensitive", () => {
    const hl = bestEffortNameHighlight("majoran", "Oregano, Majoran und Basilikum");
    expect(hl).toEqual([{ kind: "name", range: [9, 16] }]);
  });

  it("returns [] when the name is absent", () => {
    expect(bestEffortNameHighlight("Knoblauch", "Oregano und Majoran")).toEqual([]);
  });

  it("returns [] for an empty name", () => {
    expect(bestEffortNameHighlight("  ", "Oregano und Majoran")).toEqual([]);
  });

  it("does not match a substring inside another word", () => {
    // "Ananas" must not match the "ana" inside "Banane".
    expect(bestEffortNameHighlight("ana", "Banane")).toEqual([]);
  });
});
