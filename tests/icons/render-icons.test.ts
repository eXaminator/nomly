import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderIcons } from "../../scripts/render-icons.mts";

const MIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#E1721F"/></svg>`;

describe("renderIcons", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nomly-icons-"));
    await writeFile(join(dir, "icon.svg"), MIN_SVG);
    await writeFile(join(dir, "icon-maskable.svg"), MIN_SVG);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("renders all expected sizes from icon.svg", async () => {
    await renderIcons(dir);
    for (const size of [180, 192, 384, 512]) {
      const f = join(dir, `icon-${size}.png`);
      const s = await stat(f);
      expect(s.isFile()).toBe(true);
      expect(s.size).toBeGreaterThan(100);
    }
  });

  it("renders the maskable 512 variant from icon-maskable.svg", async () => {
    await renderIcons(dir);
    const s = await stat(join(dir, "icon-maskable-512.png"));
    expect(s.isFile()).toBe(true);
  });
});
