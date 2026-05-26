import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("web manifest", () => {
  const m = manifest();

  it("declares the standalone PWA basics", () => {
    expect(m.name).toBe("nomly");
    expect(m.short_name).toBe("nomly");
    expect(m.start_url).toBe("/einkauf");
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.lang).toBe("de");
    expect(m.theme_color).toBe("#E1721F");
  });

  it("lists all required icon sizes including the maskable variant", () => {
    const sizes = m.icons!.map((i) => i.sizes);
    expect(sizes).toEqual(
      expect.arrayContaining(["192x192", "384x384", "512x512"]),
    );
    expect(m.icons!.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("declares the four shortcut targets", () => {
    const urls = m.shortcuts!.map((s) => s.url);
    expect(urls).toEqual(["/einkauf", "/plan", "/rezepte", "/rezepte/neu"]);
  });
});
