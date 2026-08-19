import { describe, it, expect } from "vitest";
import { highlightIngredientMentions } from "@/lib/markdown";

const CLS = "ingredient-mention";

/** Wrap shorthand for the expected span. */
function span(text: string, id: string): string {
  return `<span class="${CLS}" tabindex="0" data-mention="${id}">${text}</span>`;
}

describe("highlightIngredientMentions", () => {
  it("wraps a plain ingredient mention with its mention id", () => {
    const out = highlightIngredientMentions("<p>Die Zwiebel anbraten.</p>", [
      { spellings: ["Zwiebel"], id: "0" },
    ]);
    expect(out).toBe(`<p>Die ${span("Zwiebel", "0")} anbraten.</p>`);
  });

  it("highlights the whole inflected word for a singular name", () => {
    const out = highlightIngredientMentions(
      "<p>Die Zwiebeln und Tomaten schneiden.</p>",
      [
        { spellings: ["Zwiebel"], id: "0" },
        { spellings: ["Tomate"], id: "1" },
      ],
    );
    expect(out).toContain(span("Zwiebeln", "0"));
    expect(out).toContain(span("Tomaten", "1"));
  });

  it("matches case-insensitively but preserves the source casing", () => {
    const out = highlightIngredientMentions("<p>zwiebeln</p>", [
      { spellings: ["Zwiebel"], id: "0" },
    ]);
    expect(out).toBe(`<p>${span("zwiebeln", "0")}</p>`);
  });

  it("anchors at a word start (no mid-word matches)", () => {
    const out = highlightIngredientMentions("<p>zwei Eier</p>", [
      { spellings: ["Ei"], id: "0" },
    ]);
    expect(out).toBe(`<p>zwei ${span("Eier", "0")}</p>`);
  });

  it("prefers the longest matching name and uses its id", () => {
    const out = highlightIngredientMentions("<p>Tomatenmark</p>", [
      { spellings: ["Tomate"], id: "0" },
      { spellings: ["Tomatenmark"], id: "1" },
    ]);
    expect(out).toBe(`<p>${span("Tomatenmark", "1")}</p>`);
  });

  it("resolves the id via the matched spelling, not the matched text", () => {
    const out = highlightIngredientMentions("<p>Zwiebeln</p>", [
      { spellings: ["Knoblauch"], id: "0" },
      { spellings: ["Zwiebel"], id: "1" },
    ]);
    expect(out).toBe(`<p>${span("Zwiebeln", "1")}</p>`);
  });

  it("matches any of an ingredient's spellings (aliases)", () => {
    const out = highlightIngredientMentions("<p>Knoblauchzehen hacken</p>", [
      { spellings: ["Knoblauch", "Knoblauchzehe"], id: "3" },
    ]);
    expect(out).toBe(`<p>${span("Knoblauchzehen", "3")} hacken</p>`);
  });

  it("escapes HTML-special characters in the id", () => {
    const out = highlightIngredientMentions("<p>Sahne</p>", [
      { spellings: ["Sahne"], id: 'a"&<>' },
    ]);
    expect(out).toBe(`<p>${span("Sahne", "a&quot;&amp;&lt;&gt;")}</p>`);
  });

  it("omits the mention id and focus target when there is no id", () => {
    const out = highlightIngredientMentions("<p>Salz</p>", [
      { spellings: ["Salz"], id: "" },
    ]);
    expect(out).toBe(`<p><span class="${CLS}">Salz</span></p>`);
  });

  it("ignores mentions inside code spans", () => {
    const out = highlightIngredientMentions(
      "<p><code>Zwiebel</code> und Zwiebel</p>",
      [{ spellings: ["Zwiebel"], id: "0" }],
    );
    expect(out).toBe(
      `<p><code>Zwiebel</code> und ${span("Zwiebel", "0")}</p>`,
    );
  });

  it("ignores mentions inside links", () => {
    const out = highlightIngredientMentions('<p><a href="/x">Zwiebel</a></p>', [
      { spellings: ["Zwiebel"], id: "0" },
    ]);
    expect(out).toBe('<p><a href="/x">Zwiebel</a></p>');
  });

  it("does not match inside HTML attributes", () => {
    const out = highlightIngredientMentions(
      '<p><img alt="Zwiebel" src="/z.jpg">Zwiebel</p>',
      [{ spellings: ["Zwiebel"], id: "0" }],
    );
    expect(out).toBe(
      `<p><img alt="Zwiebel" src="/z.jpg">${span("Zwiebel", "0")}</p>`,
    );
  });

  it("escapes regex-special characters in spellings", () => {
    const out = highlightIngredientMentions("<p>Mehl (Typ 405) sieben</p>", [
      { spellings: ["Mehl (Typ 405)"], id: "0" },
    ]);
    expect(out).toBe(`<p>${span("Mehl (Typ 405)", "0")} sieben</p>`);
  });

  it("matches names with umlauts", () => {
    const out = highlightIngredientMentions("<p>in Öl braten</p>", [
      { spellings: ["Öl"], id: "0" },
    ]);
    expect(out).toBe(`<p>in ${span("Öl", "0")} braten</p>`);
  });

  it("lets a short spelling take a plural ending", () => {
    const out = highlightIngredientMentions("<p>zwei Eier und Öle</p>", [
      { spellings: ["Ei"], id: "0" },
      { spellings: ["Öl"], id: "1" },
    ]);
    expect(out).toContain(span("Eier", "0"));
    expect(out).toContain(span("Öle", "1"));
  });

  it("does not let a short spelling swallow a filler word", () => {
    // "Ei" + an open-ended letter tail used to light up "Eine"/"Einen".
    const out = highlightIngredientMentions(
      "<p>Eine Prise Salz, einen Schuss Öl, eingeweichte Bohnen</p>",
      [
        { spellings: ["Ei"], id: "0" },
        { spellings: ["Öl"], id: "1" },
      ],
    );
    // Only the real "Öl" lights up; "Eine", "einen" and "eingeweichte" stay
    // plain text.
    expect(out).toBe(
      `<p>Eine Prise Salz, einen Schuss ${span("Öl", "1")}, eingeweichte Bohnen</p>`,
    );
  });

  it("still extends a long spelling across a compound tail", () => {
    const out = highlightIngredientMentions("<p>Knoblauchzehen hacken</p>", [
      { spellings: ["Knoblauch"], id: "0" },
    ]);
    expect(out).toBe(`<p>${span("Knoblauchzehen", "0")} hacken</p>`);
  });

  it("ignores spellings shorter than two characters", () => {
    const out = highlightIngredientMentions("<p>a b c</p>", [
      { spellings: ["a"], id: "0" },
    ]);
    expect(out).toBe("<p>a b c</p>");
  });

  it("returns the html unchanged when there are no mentions", () => {
    const html = "<p>Die Zwiebel anbraten.</p>";
    expect(highlightIngredientMentions(html, [])).toBe(html);
  });

  it("deduplicates and ignores blank spellings", () => {
    const out = highlightIngredientMentions("<p>Zwiebel</p>", [
      { spellings: ["Zwiebel", "  ", "zwiebel"], id: "0" },
    ]);
    expect(out).toBe(`<p>${span("Zwiebel", "0")}</p>`);
  });
});
