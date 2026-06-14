import { describe, it, expect } from "vitest";
import { notesForAdoptedName } from "@/components/recipes/alias-notes";

describe("notesForAdoptedName", () => {
  it("drops the peeled word that the adopted name now covers", () => {
    // "Cherry Tomaten" → alias "Tomaten", note "Cherry". Keeping "Cherry Tomaten"
    // as the name → the note must no longer contain "Cherry".
    expect(notesForAdoptedName("Cherry", "Cherry Tomaten", "Tomaten")).toBeNull();
  });

  it("keeps genuine note clauses, drops only the name-gained word", () => {
    expect(notesForAdoptedName("Cherry, fein gehackt", "Cherry Tomaten", "Tomaten")).toBe(
      "fein gehackt",
    );
  });

  it("drops a German declined descriptor now in the name ('rote')", () => {
    expect(notesForAdoptedName("rote, in Ringen", "rote Zwiebel", "Zwiebel")).toBe("in Ringen");
  });

  it("removes the gained word mid-clause but keeps the rest", () => {
    expect(notesForAdoptedName("sehr fein, Cherry", "Cherry Tomaten", "Tomaten")).toBe(
      "sehr fein",
    );
  });

  it("is a no-op when the adopted name adds nothing over the alias", () => {
    expect(notesForAdoptedName("fein gehackt", "Tomaten", "Tomaten")).toBe("fein gehackt");
  });

  it("returns null/empty notes unchanged", () => {
    expect(notesForAdoptedName(null, "Cherry Tomaten", "Tomaten")).toBeNull();
    expect(notesForAdoptedName("", "Cherry Tomaten", "Tomaten")).toBeNull();
  });

  it("matches case-insensitively and ignores edge punctuation", () => {
    expect(notesForAdoptedName("cherry, geviertelt", "Cherry Tomaten", "Tomaten")).toBe(
      "geviertelt",
    );
  });
});
