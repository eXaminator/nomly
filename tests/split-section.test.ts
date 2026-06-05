import { describe, expect, it } from "vitest";
import { splitSectionAt } from "@/components/recipes/split-section";
import {
  emptyIngredient,
  emptySection,
  type DraftSection,
} from "@/components/recipes/types";

function section(title: string, count: number): DraftSection {
  return {
    ...emptySection(),
    title,
    instructions: `Anleitung für ${title}`,
    ingredients: Array.from({ length: count }, (_, i) => ({
      ...emptyIngredient(),
      name: `${title}-Zutat-${i}`,
    })),
  };
}

describe("splitSectionAt", () => {
  it("moves the ingredients below the boundary into a fresh section after the current one", () => {
    const a = section("Teig", 4);
    const b = section("Belag", 2);
    const result = splitSectionAt([a, b], 0, 2);
    expect(result).not.toBeNull();
    const { sections, newSectionUid } = result!;

    expect(sections).toHaveLength(3);
    // Upper half keeps title, instructions and the first two rows.
    expect(sections[0].uid).toBe(a.uid);
    expect(sections[0].title).toBe("Teig");
    expect(sections[0].instructions).toBe("Anleitung für Teig");
    expect(sections[0].ingredients.map((i) => i.name)).toEqual([
      "Teig-Zutat-0",
      "Teig-Zutat-1",
    ]);
    // New section: fresh uid, empty title/instructions, the moved rows.
    expect(sections[1].uid).toBe(newSectionUid);
    expect(sections[1].uid).not.toBe(a.uid);
    expect(sections[1].uid).not.toBe(b.uid);
    expect(sections[1].title).toBe("");
    expect(sections[1].instructions).toBe("");
    expect(sections[1].ingredients.map((i) => i.name)).toEqual([
      "Teig-Zutat-2",
      "Teig-Zutat-3",
    ]);
    // Following sections are untouched.
    expect(sections[2]).toBe(b);
  });

  it("does not mutate the input", () => {
    const a = section("Teig", 3);
    const input = [a];
    splitSectionAt(input, 0, 1);
    expect(input).toHaveLength(1);
    expect(a.ingredients).toHaveLength(3);
  });

  it("returns null when the boundary would leave an empty half", () => {
    const a = section("Teig", 3);
    expect(splitSectionAt([a], 0, 0)).toBeNull();
    expect(splitSectionAt([a], 0, 3)).toBeNull();
    expect(splitSectionAt([a], 0, -1)).toBeNull();
  });

  it("returns null for an out-of-range section index", () => {
    const a = section("Teig", 3);
    expect(splitSectionAt([a], 1, 1)).toBeNull();
    expect(splitSectionAt([a], -1, 1)).toBeNull();
  });
});
