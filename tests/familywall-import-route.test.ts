import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import sharp from "sharp";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-fw-route-"));
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

function rawBody(over: Record<string, unknown> = {}) {
  return {
    title: "Route Recipe",
    description: null,
    servings: 4,
    prepTimeMin: 10,
    cookTimeMin: 20,
    ingredients: ["500 g Hackfleisch"],
    instructions: ["Anbraten."],
    sourceUrl: null,
    imageUrl: null,
    isFavorite: false,
    tags: [],
    ...over,
  };
}

function post(body: unknown): Promise<Response> {
  return import("@/app/api/v1/recipes/import-familywall/route").then(({ POST }) =>
    POST(
      new Request("http://localhost/api/v1/recipes/import-familywall", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  );
}

describe("POST /api/v1/recipes/import-familywall", () => {
  it("imports a raw recipe and returns 201 with the outcome", async () => {
    const res = await post({ raw: rawBody({ title: "Route A" }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.outcome).toBe("imported");
    expect(typeof json.id).toBe("number");

    const { db } = await import("@/db");
    const { recipe } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const row = db.select().from(recipe).where(eq(recipe.id, json.id)).get();
    expect(row?.title).toBe("Route A");
  });

  it("transfers an image sent as base64 and stores it as the recipe photo", async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
      .png()
      .toBuffer();
    const res = await post({
      raw: rawBody({ title: "Route Bild" }),
      imageBase64: png.toString("base64"),
    });
    expect(res.status).toBe(201);
    const json = await res.json();

    const { db } = await import("@/db");
    const { recipe } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const row = db.select().from(recipe).where(eq(recipe.id, json.id)).get();
    expect(row?.photoPath).toMatch(/^photos\/[a-f0-9-]+\.webp$/);
  });

  it("returns 400 on an invalid body (missing title)", async () => {
    const res = await post({ raw: rawBody({ title: "" }) });
    expect(res.status).toBe(400);
  });

  it("skips a duplicate (200, outcome=skipped) and overwrites with ?overwrite", async () => {
    const body = { raw: rawBody({ title: "Route Dup", sourceUrl: "https://ex.com/d" }) };
    const first = await post(body);
    expect((await first.json()).outcome).toBe("imported");

    const dup = await post(body);
    expect(dup.status).toBe(200);
    expect((await dup.json()).outcome).toBe("skipped");

    const over = await post({ ...body, overwrite: true });
    expect((await over.json()).outcome).toBe("updated");
  });
});
