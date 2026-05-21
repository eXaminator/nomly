import { describe, it, expect } from "vitest";

import {
  findMergeClusters,
  type ProposalItem,
} from "@/lib/stammdaten/shared/merge-proposals";

function mk(
  id: number,
  name: string,
  aliases: string[] = [],
  refCount = 0,
): ProposalItem {
  return { id, name, aliases, refCount };
}

describe("findMergeClusters", () => {
  it("groups German plurals", () => {
    const clusters = findMergeClusters([
      mk(1, "Tomate"),
      mk(2, "Tomaten"),
      mk(3, "Möhre"),
      mk(4, "Möhren"),
      mk(5, "Salz"),
    ]);
    expect(clusters).toHaveLength(2);
    const ids = clusters.map((c) => c.items.map((i) => i.id).sort());
    expect(ids).toEqual(
      expect.arrayContaining([[1, 2], [3, 4]]),
    );
  });

  it("groups diacritic variants", () => {
    const clusters = findMergeClusters([
      mk(1, "Möhre"),
      mk(2, "Moehre"),
      mk(3, "Apfel"),
    ]);
    // "Moehre" → unaccent "moehre"; "Möhre" → unaccent "mohre".
    // edit distance 1 between "moehre" and "mohre" (length 6 vs 5) → 5/6 ≈ 0.83
    expect(clusters).toHaveLength(1);
    expect(clusters[0].items.map((i) => i.id).sort()).toEqual([1, 2]);
  });

  it("does not merge truly different names", () => {
    const clusters = findMergeClusters([
      mk(1, "Salz"),
      mk(2, "Pfeffer"),
      mk(3, "Mehl"),
    ]);
    expect(clusters).toHaveLength(0);
  });

  it("default winner has the most aliases, then most refs, then lowest id", () => {
    const clusters = findMergeClusters([
      mk(1, "Tomate", [], 0),
      mk(2, "Tomaten", ["Tomate"], 5),
      mk(3, "Tomato", [], 2),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].defaultWinnerId).toBe(2);
  });

  it("transitive: A~B and B~C produce one cluster", () => {
    // "Knoblauch" ~ "Knoblauchzehe" — false, edit distance > threshold
    // Use a transitive example: "Champignon" ~ "Champignons" ~ "Champignone" (typo)
    const clusters = findMergeClusters([
      mk(1, "Champignon"),
      mk(2, "Champignons"),
      mk(3, "Champignone"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].items.map((i) => i.id).sort()).toEqual([1, 2, 3]);
  });

  it("returns empty for fewer than 2 items", () => {
    expect(findMergeClusters([])).toEqual([]);
    expect(findMergeClusters([mk(1, "Salz")])).toEqual([]);
  });

  it("'-innen' (5-char) suffix is detected past the length-gap fast-reject", () => {
    const clusters = findMergeClusters([
      mk(1, "Lehrer"),
      mk(2, "Lehrerinnen"),
      mk(3, "Apfel"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].items.map((i) => i.id).sort()).toEqual([1, 2]);
  });
});
