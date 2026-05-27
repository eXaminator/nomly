import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestRawRecipe } from "@/lib/familywall/ingest";
import type { FamilywallRawRecipe } from "@/lib/familywall/types";

// Bearer-authed (gated by the global proxy) endpoint for the Familywall
// importer: the client downloads + parses snapshots locally — where
// Playwright/jsdom live — and POSTs the already-parsed recipe plus its photo
// bytes here. Ingest (ingredient/unit matching against the LIVE catalog,
// dedup, write) happens server-side, so the IDs are always prod's. No jsdom
// or Playwright on this path, so it runs in the pruned production image.

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const rawSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().default(null),
  servings: z.number().int().positive().nullable().default(null),
  prepTimeMin: z.number().int().nonnegative().nullable().default(null),
  cookTimeMin: z.number().int().nonnegative().nullable().default(null),
  ingredients: z.array(z.string()).default([]),
  instructions: z.array(z.string()).default([]),
  sourceUrl: z.string().nullable().default(null),
  imageUrl: z.string().nullable().default(null),
  isFavorite: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
});

const requestSchema = z.object({
  raw: rawSchema,
  /** Recipe photo bytes, base64-encoded. Stored server-side via savePhotoBuffer. */
  imageBase64: z.string().nullable().optional(),
  overwrite: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let imageBytes: Buffer | null = null;
  if (parsed.data.imageBase64) {
    imageBytes = Buffer.from(parsed.data.imageBase64, "base64");
    if (imageBytes.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "image too large" }, { status: 413 });
    }
  }

  const raw = parsed.data.raw as FamilywallRawRecipe;
  const result = await ingestRawRecipe(raw, imageBytes, {
    overwrite: parsed.data.overwrite,
    dryRun: parsed.data.dryRun,
  });

  if (result.outcome === "failed") {
    return NextResponse.json(result, { status: 422 });
  }
  const status = result.outcome === "imported" ? 201 : 200;
  return NextResponse.json(result, { status });
}
