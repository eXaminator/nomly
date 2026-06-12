import { describe, expect, it } from "vitest";
import {
  addAlternativeAfter,
  canDemote,
  demoteToAlternative,
  detachAlternative,
  findPrimaryIndex,
  lastInGroup,
  moveAlternativeWithinGroup,
  promoteAlternative,
} from "@/components/recipes/alternatives";
import type { DraftIngredient } from "@/components/recipes/types";

/** Minimal draft row — only the fields the grouping helpers read/keep matter;
 *  `name` is carried only to make the assertions legible. */
function row(
  name: string,
  isAlternative = false,
  isOptional = false,
): DraftIngredient {
  return {
    uid: name,
    name,
    canonicalName: null,
    selectedIngredientId: null,
    candidates: [],
    addAsAlias: false,
    unassigned: false,
    quantity: "",
    unit: null,
    notes: "",
    isOptional,
    fixedAmount: false,
    isAlternative,
  };
}

/** Compact "name(flags)" view so structure assertions read at a glance. */
function shape(rows: DraftIngredient[]): string[] {
  return rows.map(
    (r) => `${r.name}${r.isAlternative ? "/alt" : ""}${r.isOptional ? "/opt" : ""}`,
  );
}

describe("alternative grouping helpers", () => {
  it("findPrimaryIndex / lastInGroup walk the depth-1 group", () => {
    const rows = [row("A"), row("a1", true), row("a2", true), row("B")];
    expect(findPrimaryIndex(rows, 2)).toBe(0);
    expect(findPrimaryIndex(rows, 3)).toBe(3);
    expect(lastInGroup(rows, 0)).toBe(2);
    expect(lastInGroup(rows, 3)).toBe(3);
  });

  it("addAlternativeAfter inserts at the END of the target group", () => {
    const rows = [row("A"), row("a1", true), row("B")];
    // Add from the primary A — lands after its last existing alternative.
    const out = addAlternativeAfter(rows, 0);
    expect(out.map((r) => r.isAlternative)).toEqual([false, true, true, false]);
    expect(out[2].isAlternative).toBe(true);
    expect(out[2].isOptional).toBe(true); // alternatives start optional
    expect(out[3].name).toBe("B");
    expect(rows).toHaveLength(3); // input untouched
  });

  it("promoteAlternative swaps leadership and preserves optional shape", () => {
    const rows = [row("A", false, false), row("a1", true, true), row("a2", true, true)];
    const out = promoteAlternative(rows, 1);
    expect(shape(out)).toEqual(["a1", "A/alt/opt", "a2/alt/opt"]);
    // promoted leader inherits the OLD primary's optional status (false here)
    expect(out[0].isOptional).toBe(false);
  });

  it("detachAlternative lifts an alt out to a standalone primary after the group", () => {
    const rows = [row("A"), row("a1", true, true), row("a2", true, true), row("B")];
    const out = detachAlternative(rows, 1);
    // The detached row becomes a primary but keeps its optional flag (matching
    // the editor's existing behavior — the user can clear it afterwards).
    expect(shape(out)).toEqual(["A", "a2/alt/opt", "a1/opt", "B"]);
    expect(out[2].isAlternative).toBe(false);
  });

  it("demoteToAlternative folds a lone primary into the previous group", () => {
    const rows = [row("A"), row("B")];
    expect(canDemote(rows, 1)).toBe(true);
    const out = demoteToAlternative(rows, 1);
    expect(shape(out)).toEqual(["A", "B/alt/opt"]);
  });

  it("canDemote / demoteToAlternative refuse invalid moves", () => {
    const rows = [row("A"), row("a1", true), row("B")];
    expect(canDemote(rows, 0)).toBe(false); // first row
    expect(canDemote(rows, 1)).toBe(false); // already an alternative
    // B (idx 2) is a lone primary preceded by a group → demotable
    expect(canDemote(rows, 2)).toBe(true);
    // A primary that owns alternatives may not demote (would orphan them).
    const owns = [row("A"), row("a1", true), row("C")];
    // make C own an alt
    const ownsAlt = [...owns, row("c1", true)];
    expect(canDemote(ownsAlt, 2)).toBe(false);
    expect(shape(demoteToAlternative(rows, 0))).toEqual(shape(rows)); // no-op
  });

  it("moveAlternativeWithinGroup reorders alternatives among themselves", () => {
    const rows = [row("A"), row("a1", true, true), row("a2", true, true), row("B")];
    // a2 (idx 2) → before a1 (idx 1)
    expect(shape(moveAlternativeWithinGroup(rows, 2, 1))).toEqual([
      "A",
      "a2/alt/opt",
      "a1/alt/opt",
      "B",
    ]);
    // a1 (idx 1) → after a2 (idx 2): same result the other way round
    expect(shape(moveAlternativeWithinGroup(rows, 1, 2))).toEqual([
      "A",
      "a2/alt/opt",
      "a1/alt/opt",
      "B",
    ]);
    expect(rows).toHaveLength(4); // input untouched
  });

  it("moveAlternativeWithinGroup clamps to the group, never crossing into a neighbour", () => {
    const rows = [row("A"), row("a1", true, true), row("a2", true, true), row("B")];
    // Target the primary slot (0) → clamped to first alt slot (1) = no real move
    expect(shape(moveAlternativeWithinGroup(rows, 1, 0))).toEqual(shape(rows));
    // Target B's slot (3) → clamped to the group's last alt (2)
    expect(shape(moveAlternativeWithinGroup(rows, 1, 3))).toEqual([
      "A",
      "a2/alt/opt",
      "a1/alt/opt",
      "B",
    ]);
  });

  it("moveAlternativeWithinGroup is a no-op on a primary row", () => {
    const rows = [row("A"), row("a1", true), row("B")];
    expect(shape(moveAlternativeWithinGroup(rows, 0, 1))).toEqual(shape(rows));
    expect(shape(moveAlternativeWithinGroup(rows, 2, 0))).toEqual(shape(rows));
  });

  // Deleting an alternative now RE-PARSES its source line with the alternative
  // folded into the primary's note (the AST regenerates it) — see
  // reparseDeletingAlternative (components/recipes/reparse.ts) and the
  // forceFoldRanges parser test. The old string-based removeAlternativeFoldingNote
  // helper was removed, so there's nothing to unit-test here.

  it("promote/detach are no-ops on a primary index", () => {
    const rows = [row("A"), row("a1", true)];
    expect(shape(promoteAlternative(rows, 0))).toEqual(shape(rows));
    expect(shape(detachAlternative(rows, 0))).toEqual(shape(rows));
  });
});
