import { describe, expect, it } from "vitest";
import { liveMatchQuery } from "@/components/recipes/types";

/**
 * `liveMatchQuery` decides which text a row sends to the live ingredient
 * matcher. The interesting case is alternatives: they inherit the primary's
 * whole "X or Y" source line as `rawText`, but `/match` only returns the first
 * parsed row's candidates — so an alternative must query its OWN fragment or
 * its ingredient drops out of the pill list (and the alias with it).
 */
describe("liveMatchQuery", () => {
  it("primary rows query the full source line (rawText)", () => {
    expect(
      liveMatchQuery({
        isAlternative: false,
        rawText: "1 medium tomato, diced",
        name: "tomato",
        originalName: undefined,
      }),
    ).toBe("1 medium tomato, diced");
  });

  it("primary rows fall back to the name when there's no rawText", () => {
    expect(
      liveMatchQuery({
        isAlternative: false,
        rawText: undefined,
        name: "tomato",
        originalName: undefined,
      }),
    ).toBe("tomato");
  });

  it("alternative rows query their own fragment, NOT the inherited full line", () => {
    // The "drumsticks" alternative split off "…chicken thighs or drumsticks".
    // Its rawText is the whole line; querying that would surface the primary's
    // (chicken thigh) candidates, so it must query its own source span instead.
    expect(
      liveMatchQuery({
        isAlternative: true,
        rawText:
          "2 (about 6-8 ounce / 170-225g each) bone-in, skin-on chicken thighs or drumsticks",
        name: "drumstick",
        originalName: "drumsticks",
      }),
    ).toBe("drumsticks");
  });

  it("alternative rows fall back to the name when there's no original span", () => {
    expect(
      liveMatchQuery({
        isAlternative: true,
        rawText: "chicken thighs or drumsticks",
        name: "drumstick",
        originalName: undefined,
      }),
    ).toBe("drumstick");
  });
});
