import { describe, expect, it } from "vitest";
import {
  buildIngredientMentions,
  type MentionRow,
} from "@/components/recipes/ingredient-mentions";

/** A minimal consumable row; override just what the case is about. */
let nextRowId = 1;

function row(over: Partial<MentionRow> & { ingredientName: string }): MentionRow {
  return {
    id: nextRowId++,
    ingredientId: null,
    canonicalIngredientName: null,
    aliases: [],
    alternativeForId: null,
    isEquipment: false,
    quantity: null,
    quantityLow: null,
    quantifierName: null,
    quantifierValue: null,
    quantifierSource: null,
    unitLabel: null,
    notes: null,
    isOptional: false,
    fixedAmount: false,
    dietaryClass: null,
    ...over,
  };
}

/** Spellings of the mention whose tooltip names `name`. */
function spellingsFor(
  built: ReturnType<typeof buildIngredientMentions>,
  name: string,
): string[] {
  const index = built.tips.findIndex((rows) => rows.some((t) => t.name === name));
  expect(index, `no mention for ${name}`).toBeGreaterThanOrEqual(0);
  return built.mentions[index].spellings;
}

describe("buildIngredientMentions", () => {
  describe("alternative groups in the tooltip", () => {
    /** Primary + two alternatives, as the recipe view hands them over. */
    function lentilGroup() {
      const primary = row({
        id: 10,
        ingredientId: 1,
        ingredientName: "green lentils",
        quantity: 250,
      });
      return [
        primary,
        row({
          id: 11,
          ingredientId: 2,
          ingredientName: "black lentils",
          quantity: 250,
          isOptional: true,
          alternativeForId: 10,
        }),
        row({
          id: 12,
          ingredientId: 3,
          ingredientName: "beluga lentils",
          quantity: 200,
          isOptional: true,
          alternativeForId: 10,
        }),
      ];
    }

    it("shows the whole group when the primary is matched", () => {
      const built = buildIngredientMentions(lentilGroup());
      const tips = built.tips[0];
      expect(tips.map((t) => t.name)).toEqual([
        "green lentils",
        "black lentils",
        "beluga lentils",
      ]);
      expect(tips.map((t) => t.isAlternative)).toEqual([false, true, true]);
    });

    it("shows the whole group when an ALTERNATIVE is matched", () => {
      const built = buildIngredientMentions(lentilGroup());
      // "black lentils" is its own mention — but its tooltip lists the group.
      const tips = built.tips[1];
      expect(tips.map((t) => t.name)).toEqual([
        "green lentils",
        "black lentils",
        "beluga lentils",
      ]);
      expect(tips.map((t) => t.isAlternative)).toEqual([false, true, true]);
    });

    it("keeps each mention resolving to the ingredient the prose named", () => {
      const built = buildIngredientMentions(lentilGroup());
      expect(built.mentions[0].spellings).toContain("green lentils");
      expect(built.mentions[0].spellings).not.toContain("black lentils");
      expect(built.mentions[1].spellings).toContain("black lentils");
      expect(built.mentions[1].spellings).not.toContain("green lentils");
    });

    it("carries the group's amounts, not just its names", () => {
      const built = buildIngredientMentions(lentilGroup());
      expect(built.tips[1].map((t) => t.quantity)).toEqual([250, 250, 200]);
    });

    it("leads with the primary even when the rows arrive alternative-first", () => {
      const [primary, ...alternatives] = lentilGroup();
      const built = buildIngredientMentions([...alternatives, primary]);
      expect(built.tips[0].map((t) => t.name)).toEqual([
        "green lentils",
        "black lentils",
        "beluga lentils",
      ]);
    });

    it("does not stack a group twice for one mention", () => {
      // The same ingredient listed twice inside one alternative group.
      const built = buildIngredientMentions([
        row({ id: 20, ingredientId: 1, ingredientName: "Sahne" }),
        row({ id: 21, ingredientId: 1, ingredientName: "Sahne", alternativeForId: 20 }),
      ]);
      expect(built.mentions).toHaveLength(1);
      expect(built.tips[0]).toHaveLength(2);
    });

    it("marks which alternative the meal bought", () => {
      // ?meal=<id> resolved to "the cook took the black lentils".
      const built = buildIngredientMentions(lentilGroup(), new Set([11]));
      expect(built.tips[0].map((t) => [t.name, t.emphasis])).toEqual([
        ["green lentils", "muted"],
        ["black lentils", "chosen"],
        ["beluga lentils", "muted"],
      ]);
      // Matching the alternative shows the same decision.
      expect(built.tips[1].map((t) => t.emphasis)).toEqual([
        "muted",
        "chosen",
        "muted",
      ]);
    });

    it("emphasizes the primary when the meal kept it", () => {
      const built = buildIngredientMentions(lentilGroup(), new Set([10]));
      expect(built.tips[0].map((t) => t.emphasis)).toEqual([
        "chosen",
        "muted",
        "muted",
      ]);
    });

    it("leaves the tooltip untouched without a meal in context", () => {
      const built = buildIngredientMentions(lentilGroup());
      expect(built.tips[0].map((t) => t.emphasis)).toEqual([
        "default",
        "default",
        "default",
      ]);
    });

    it("never lets the meal's choice change which spellings match", () => {
      const plain = buildIngredientMentions(lentilGroup());
      const withMeal = buildIngredientMentions(lentilGroup(), new Set([11]));
      expect(withMeal.mentions).toEqual(plain.mentions);
    });

    it("marks a plain ingredient as not-alternative", () => {
      const built = buildIngredientMentions([
        row({ ingredientId: 1, ingredientName: "Mehl" }),
      ]);
      expect(built.tips[0][0].isAlternative).toBe(false);
    });
  });

  it("feeds the display name, the canonical name and every alias", () => {
    const built = buildIngredientMentions([
      row({
        ingredientId: 1,
        ingredientName: "Knoblauchzehen",
        canonicalIngredientName: "Knoblauch",
        aliases: ["garlic", "garlic clove"],
      }),
    ]);
    expect(spellingsFor(built, "Knoblauchzehen")).toEqual(
      expect.arrayContaining([
        "Knoblauchzehen",
        "Knoblauch",
        "garlic",
        "garlic clove",
      ]),
    );
  });

  it("collapses rows of the same ingredient into one mention with stacked tips", () => {
    const built = buildIngredientMentions([
      row({ ingredientId: 7, ingredientName: "Zucker", quantity: 100 }),
      row({ ingredientId: 7, ingredientName: "Zucker", quantity: 20 }),
    ]);
    expect(built.mentions).toHaveLength(1);
    expect(built.tips[0].map((t) => t.quantity)).toEqual([100, 20]);
  });

  it("orders a stacked tooltip by the order the rows come in", () => {
    // The recipe view passes the section's own rows first, so a section that
    // lists an ingredient the other sections also list leads with its own.
    const built = buildIngredientMentions([
      row({ ingredientId: 7, ingredientName: "Zucker", quantity: 100 }),
      row({ ingredientId: 7, ingredientName: "Zucker", quantity: 50 }),
      row({ ingredientId: 8, ingredientName: "Zimt", quantity: 1 }),
    ]);
    expect(built.tips[0].map((t) => t.quantity)).toEqual([100, 50]);
    expect(built.mentions[1].spellings).toContain("Zimt");
  });

  it("keeps unassigned rows apart by name", () => {
    const built = buildIngredientMentions([
      row({ ingredientName: "Deko" }),
      row({ ingredientName: "Beilage" }),
    ]);
    expect(built.mentions).toHaveLength(2);
  });

  it("skips equipment", () => {
    const built = buildIngredientMentions([
      row({ ingredientId: 1, ingredientName: "Backpapier", isEquipment: true }),
      row({ ingredientId: 2, ingredientName: "Mehl" }),
    ]);
    expect(built.mentions).toHaveLength(1);
    expect(built.mentions[0].spellings).toContain("Mehl");
  });

  it("offers the tail of a multi-word name when nothing else claims it", () => {
    const built = buildIngredientMentions([
      row({ ingredientId: 1, ingredientName: "green lentils" }),
      row({ ingredientId: 2, ingredientName: "Karotten" }),
    ]);
    expect(spellingsFor(built, "green lentils")).toContain("lentils");
  });

  it("offers every tail of a longer name", () => {
    const built = buildIngredientMentions([
      row({ ingredientId: 1, ingredientName: "extra virgin olive oil" }),
    ]);
    const spellings = spellingsFor(built, "extra virgin olive oil");
    expect(spellings).toContain("olive oil");
    expect(spellings).toContain("virgin olive oil");
    // "oil" is below the partial-length floor.
    expect(spellings).not.toContain("oil");
  });

  it("derives tails from aliases too", () => {
    const built = buildIngredientMentions([
      row({
        ingredientId: 1,
        ingredientName: "Linsen",
        aliases: ["braune Berglinsen"],
      }),
    ]);
    expect(spellingsFor(built, "Linsen")).toContain("Berglinsen");
  });

  it("drops a tail two different primaries could claim", () => {
    const built = buildIngredientMentions([
      row({ ingredientId: 1, ingredientName: "green lentils" }),
      row({ ingredientId: 2, ingredientName: "red lentils" }),
    ]);
    expect(spellingsFor(built, "green lentils")).not.toContain("lentils");
    expect(spellingsFor(built, "red lentils")).not.toContain("lentils");
  });

  it("gives a contested tail to the primary over its alternative", () => {
    const built = buildIngredientMentions([
      row({ ingredientId: 1, ingredientName: "green lentils" }),
      row({
        ingredientId: 2,
        ingredientName: "black lentils",
        alternativeForId: 1,
      }),
    ]);
    expect(spellingsFor(built, "green lentils")).toContain("lentils");
    expect(spellingsFor(built, "black lentils")).not.toContain("lentils");
  });

  it("drops a tail claimed only by competing alternatives", () => {
    const built = buildIngredientMentions([
      row({ ingredientId: 1, ingredientName: "Milch" }),
      row({ ingredientId: 2, ingredientName: "Hafer Drink", alternativeForId: 1 }),
      row({ ingredientId: 3, ingredientName: "Soja Drink", alternativeForId: 1 }),
    ]);
    expect(spellingsFor(built, "Hafer Drink")).not.toContain("Drink");
    expect(spellingsFor(built, "Soja Drink")).not.toContain("Drink");
  });

  it("never offers a tail that is another ingredient's own name", () => {
    const built = buildIngredientMentions([
      row({ ingredientId: 1, ingredientName: "Olivenöl" }),
      row({ ingredientId: 2, ingredientName: "kaltgepresstes Olivenöl" }),
    ]);
    // The tail "Olivenöl" is row 1's own name — it keeps it.
    expect(spellingsFor(built, "kaltgepresstes Olivenöl")).not.toContain(
      "Olivenöl",
    );
  });

  it("never offers a leading descriptor as a tail", () => {
    const built = buildIngredientMentions([
      row({ ingredientId: 1, ingredientName: "grüne Linsen" }),
    ]);
    expect(spellingsFor(built, "grüne Linsen")).not.toContain("grüne");
  });

  it("drops tails that are too short to be an ingredient", () => {
    const built = buildIngredientMentions([
      row({ ingredientId: 1, ingredientName: "natives Öl" }),
    ]);
    expect(spellingsFor(built, "natives Öl")).not.toContain("Öl");
  });

  it("drops tails that start with a filler word", () => {
    const built = buildIngredientMentions([
      row({
        ingredientId: 1,
        ingredientName: "Salz",
        aliases: ["Eine Prise Salz", "salt, adjust to taste", "salt divided"],
      }),
    ]);
    const spellings = spellingsFor(built, "Salz");
    expect(spellings).not.toContain("adjust to taste");
    expect(spellings).not.toContain("divided");
    expect(spellings).not.toContain("to taste");
    expect(spellings).not.toContain("taste");
    // The aliases themselves are still matched in full.
    expect(spellings).toContain("Eine Prise Salz");
  });

  it("splits a hyphenated name into its tail", () => {
    const built = buildIngredientMentions([
      row({ ingredientId: 1, ingredientName: "TK-Erbsen" }),
    ]);
    expect(spellingsFor(built, "TK-Erbsen")).toContain("Erbsen");
  });

  it("returns an empty result for no rows", () => {
    expect(buildIngredientMentions([])).toEqual({ mentions: [], tips: [] });
  });

  it("numbers mention ids by group so they index the tips array", () => {
    const built = buildIngredientMentions([
      row({ ingredientId: 1, ingredientName: "Mehl" }),
      row({ ingredientId: 2, ingredientName: "Zucker" }),
    ]);
    expect(built.mentions.map((m) => m.id)).toEqual(["0", "1"]);
    expect(built.tips[1][0].name).toBe("Zucker");
  });
});
