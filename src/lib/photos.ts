import { mkdirSync, existsSync } from "node:fs";
import { writeFile, readFile, stat } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

const DATA_DIR = process.env.PHOTO_DIR
  ? resolve(process.env.PHOTO_DIR)
  : resolve(process.cwd(), "data/photos");

const MAX_EDGE_PX = 1600;
const FILENAME_RE = /^[a-f0-9-]{36}\.webp$/i;

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export type PhotoPath = `photos/${string}.webp`;

/**
 * Accepts raw image bytes, normalizes to `.webp` at `<= 1600px` on the long
 * edge, and writes to `data/photos/<uuid>.webp`. Returns the path the recipe
 * row should store (e.g. `photos/abc.webp`).
 */
export async function savePhotoBuffer(buf: Buffer): Promise<PhotoPath> {
  ensureDir();
  const filename = `${randomUUID()}.webp` as const;
  const webp = await sharp(buf, { failOn: "error" })
    .rotate() // honour EXIF orientation
    .resize({
      width: MAX_EDGE_PX,
      height: MAX_EDGE_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();
  await writeFile(resolve(DATA_DIR, filename), webp);
  return `photos/${filename}` as PhotoPath;
}

/** Reads a stored photo's raw bytes + size. Throws if the filename is bogus. */
export async function readPhoto(
  filename: string,
): Promise<{ data: Buffer; size: number }> {
  if (!FILENAME_RE.test(filename)) {
    throw new Error("invalid filename");
  }
  const path = resolve(DATA_DIR, basename(filename));
  const info = await stat(path);
  const data = await readFile(path);
  return { data, size: info.size };
}
