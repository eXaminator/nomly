import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import sharp from "sharp";
import type { FamilywallRawRecipe } from "@/lib/familywall/types";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-fw-ingest-"));
process.env.DATABASE_URL = join(tempDir, "test.db");
process.env.PHOTO_DIR = join(tempDir, "photos");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  const tmpDb = drizzle(sqlite);
  migrate(tmpDb, { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeRaw(over: Partial<FamilywallRawRecipe> = {}): FamilywallRawRecipe {
  return {
    title: "Bolognese",
    description: null,
    servings: 4,
    prepTimeMin: 15,
    cookTimeMin: 90,
    ingredients: ["500 g Hackfleisch"],
    instructions: ["Anbraten.", "Schmoren."],
    sourceUrl: null,
    imageUrl: null,
    isFavorite: false,
    tags: [],
    ...over,
  };
}

async function recipeRow(id: number) {
  const { db } = await import("@/db");
  const { recipe } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(recipe).where(eq(recipe.id, id)).get();
}

async function recipeCount(): Promise<number> {
  const { db } = await import("@/db");
  const { recipe } = await import("@/db/schema");
  return db.select().from(recipe).all().length;
}

describe("ingestRawRecipe", () => {
  it("imports a new recipe and returns its id", async () => {
    const { ingestRawRecipe } = await import("@/lib/familywall/ingest");
    const res = await ingestRawRecipe(makeRaw({ title: "Neu A" }), null, {});
    expect(res.outcome).toBe("imported");
    if (res.outcome !== "imported") throw new Error("unreachable");
    const row = await recipeRow(res.id);
    expect(row?.title).toBe("Neu A");
    expect(row?.servings).toBe(4);
  });

  it("skips a duplicate (same title + sourceUrl) when overwrite is off", async () => {
    const { ingestRawRecipe } = await import("@/lib/familywall/ingest");
    const raw = makeRaw({ title: "Dup", sourceUrl: "https://example.com/x" });
    const first = await ingestRawRecipe(raw, null, {});
    expect(first.outcome).toBe("imported");
    const second = await ingestRawRecipe(raw, null, {});
    expect(second.outcome).toBe("skipped");
  });

  it("updates the existing recipe in place when overwrite is on", async () => {
    const { ingestRawRecipe } = await import("@/lib/familywall/ingest");
    const raw = makeRaw({ title: "Over", sourceUrl: "https://example.com/o", servings: 2 });
    const first = await ingestRawRecipe(raw, null, {});
    expect(first.outcome).toBe("imported");
    if (first.outcome !== "imported") throw new Error("unreachable");
    const res = await ingestRawRecipe({ ...raw, servings: 8 }, null, { overwrite: true });
    expect(res.outcome).toBe("updated");
    if (res.outcome !== "updated") throw new Error("unreachable");
    expect(res.id).toBe(first.id);
    const row = await recipeRow(res.id);
    expect(row?.servings).toBe(8);
  });

  it("dryRun writes nothing to the DB", async () => {
    const { ingestRawRecipe } = await import("@/lib/familywall/ingest");
    const before = await recipeCount();
    const res = await ingestRawRecipe(makeRaw({ title: "Ghost" }), null, { dryRun: true });
    expect(res.outcome).toBe("would-import");
    expect(await recipeCount()).toBe(before);
  });

  it("transfers the image: stores a photo and sets photoPath", async () => {
    const { ingestRawRecipe } = await import("@/lib/familywall/ingest");
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .png()
      .toBuffer();
    const res = await ingestRawRecipe(makeRaw({ title: "Mit Bild" }), png, {});
    expect(res.outcome).toBe("imported");
    if (res.outcome !== "imported") throw new Error("unreachable");
    const row = await recipeRow(res.id);
    expect(row?.photoPath).toMatch(/^photos\/[a-f0-9-]+\.webp$/);
  });
});
