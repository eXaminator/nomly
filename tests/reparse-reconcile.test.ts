import { describe, it, expect } from "vitest";
import { planSlotReconciliation } from "@/components/recipes/reparse";

const r = (a: number, b: number): [number, number] => [a, b];

describe("planSlotReconciliation", () => {
  it("force-emits a folded slot a current row claims by label (saved Schmackofatz)", () => {
    // A saved recipe: rows carry no sourceRange (parse-session only).
    const plan = planSlotReconciliation(
      [{ name: "Gurke" }, { name: "Schmackofatz" }],
      [{ range: r(0, 7), label: "Gurke" }],
      [{ range: r(12, 24), label: "Schmackofatz" }],
    );
    expect(plan.forceEmit).toContainEqual(r(12, 24));
    expect(plan.forceFold).toEqual([]);
    expect(plan.unmatchedManual).toEqual([]);
  });

  it("matches by sourceRange first, so a RENAMED in-session row is not duplicated", () => {
    // The row was parsed as "Gurke" (range 0-7) then renamed to "Gürkchen".
    // Range still matches the emitted slot → claimed, NOT a manual row.
    const plan = planSlotReconciliation(
      [{ name: "Gürkchen", range: r(0, 7) }],
      [{ range: r(0, 7), label: "Gurke" }],
      [],
    );
    expect(plan.forceFold).toEqual([]); // emitted slot is claimed → not folded
    expect(plan.unmatchedManual).toEqual([]); // not treated as manual
  });

  it("force-folds an emitted slot that no current row claims (a removed member)", () => {
    const plan = planSlotReconciliation(
      [{ name: "Salz", range: r(0, 4) }],
      [
        { range: r(0, 4), label: "Salz" },
        { range: r(9, 16), label: "Pfeffer" },
      ],
      [],
    );
    expect(plan.forceFold).toContainEqual(r(9, 16));
  });

  it("flags a current row matching no slot as a manual row", () => {
    const plan = planSlotReconciliation(
      [{ name: "Gurke", range: r(0, 7) }, { name: "Knoblauch" }],
      [{ range: r(0, 7), label: "Gurke" }],
      [],
    );
    expect(plan.unmatchedManual).toEqual([1]);
  });
});
