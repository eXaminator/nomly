import { describe, expect, it } from "vitest";
import { computeRenamePairs } from "@/components/settings/stammdaten/rename-pairs";

function alias(key: string, name: string) {
  return { key, name };
}

describe("computeRenamePairs", () => {
  it("reports a plain canonical rename", () => {
    const pairs = computeRenamePairs({
      originalName: "Tomate",
      name: "Tomate (reif)",
      aliases: [alias("existing-Tomaten", "Tomaten")],
    });
    expect(pairs).toEqual([{ from: "Tomate", to: "Tomate (reif)" }]);
  });

  it("reports a rename of an existing alias", () => {
    const pairs = computeRenamePairs({
      originalName: "Paprika",
      name: "Paprika",
      aliases: [alias("existing-Spitzpaprika", "Paprikaschote")],
    });
    expect(pairs).toEqual([{ from: "Spitzpaprika", to: "Paprikaschote" }]);
  });

  it("suppresses both pairs of a name<->alias swap (both names still exist)", () => {
    const pairs = computeRenamePairs({
      originalName: "Paprikaschote",
      name: "Paprika",
      aliases: [alias("existing-Paprika", "Paprikaschote")],
    });
    expect(pairs).toEqual([]);
  });

  it("suppresses a rename when the old name is re-added as a new alias", () => {
    const pairs = computeRenamePairs({
      originalName: "Tomate",
      name: "Cherrytomate",
      aliases: [alias("new-1", "tomate")],
    });
    // Case-insensitive: "tomate" still exists, so nothing was renamed away.
    expect(pairs).toEqual([]);
  });

  it("ignores new aliases, empty names and no-op renames", () => {
    const pairs = computeRenamePairs({
      originalName: "Tomate",
      name: "Tomate",
      aliases: [alias("new-1", "Strauchtomate"), alias("existing-Tomaten", "")],
    });
    expect(pairs).toEqual([]);
  });
});
