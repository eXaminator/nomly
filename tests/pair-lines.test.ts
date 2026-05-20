import { describe, it, expect } from "vitest";
import {
  pairTableLines,
  splitClipboardToLines,
} from "@/lib/recipe-import/pair-lines";

// Minimal unit token set for tests — only the units the cases below use.
const UNITS = new Set(["g", "el", "tl", "dose", "stück"]);

describe("pairTableLines", () => {
  it("leaves a normal single-line list untouched", () => {
    expect(
      pairTableLines(["500 g Hackfleisch", "1 Zwiebel", "Salz"], UNITS),
    ).toEqual(["500 g Hackfleisch", "1 Zwiebel", "Salz"]);
  });

  it("pairs the table-pasted chili recipe", () => {
    const raw = `6
Tomate(n)
1 kl. Dose/n
Kidneybohnen
Abtropfgewicht ca. 255 g
2
Zwiebel(n)
1 EL
Erdnussbutter
creamy
2 TL
Sambal Oelek
1 TL
Kreuzkümmelpulver
2
Knoblauchzehe(n)
Salz
Rapsöl`;
    const lines = splitClipboardToLines(raw);
    expect(pairTableLines(lines, UNITS)).toEqual([
      "6 Tomate(n)",
      "1 kl. Dose/n Kidneybohnen, Abtropfgewicht ca. 255 g",
      "2 Zwiebel(n)",
      "1 EL Erdnussbutter, creamy",
      "2 TL Sambal Oelek",
      "1 TL Kreuzkümmelpulver",
      "2 Knoblauchzehe(n)",
      "Salz",
      "Rapsöl",
    ]);
  });

  it("treats tabs from table cells the same as newlines", () => {
    const raw = "500 g\tHackfleisch\n1\tZwiebel(n)";
    const lines = splitClipboardToLines(raw);
    expect(pairTableLines(lines, UNITS)).toEqual([
      "500 g Hackfleisch",
      "1 Zwiebel(n)",
    ]);
  });

  it("name-only lines with no preceding quantity stand alone", () => {
    expect(pairTableLines(["Salz", "Pfeffer"], UNITS)).toEqual([
      "Salz",
      "Pfeffer",
    ]);
  });
});

describe("splitClipboardToLines", () => {
  it("strips list bullets and blank lines", () => {
    expect(splitClipboardToLines("- 500 g Mehl\n  \n• 1 Ei\n* Salz")).toEqual([
      "500 g Mehl",
      "1 Ei",
      "Salz",
    ]);
  });
});
