import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ICON_SIZES = [180, 192, 384, 512] as const;
const SHORTCUT_KEYS = ["einkauf", "plan", "rezepte", "neu"] as const;

async function renderTo(svgPath: string, outPath: string, size: number): Promise<void> {
  const buf = await readFile(svgPath);
  const png = await sharp(buf, { density: 384 }).resize(size, size).png().toBuffer();
  await writeFile(outPath, png);
}

export async function renderIcons(dir: string): Promise<void> {
  const iconSvg = join(dir, "icon.svg");
  for (const size of ICON_SIZES) {
    await renderTo(iconSvg, join(dir, `icon-${size}.png`), size);
  }
  const maskableSvg = join(dir, "icon-maskable.svg");
  await renderTo(maskableSvg, join(dir, "icon-maskable-512.png"), 512);

  // Shortcut icons are optional in the test harness — only render if the
  // source exists.
  for (const key of SHORTCUT_KEYS) {
    const src = join(dir, `shortcut-${key}.svg`);
    try {
      await readFile(src);
      await renderTo(src, join(dir, `shortcut-${key}-96.png`), 96);
    } catch {
      // missing — skip
    }
  }
}

// Allow running as a CLI: `node --experimental-transform-types ... scripts/render-icons.mts`
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const target = join(here, "..", "public", "icons");
  await renderIcons(target);
  console.log(`> rendered icons into ${target}`);
}
