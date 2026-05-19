import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ingredient } from "@/db/schema";

const patchSchema = z.object({
  dietaryClass: z
    .union([z.enum(["vegan", "vegetarian", "meat"]), z.null()])
    .optional(),
});

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }

  const patch: Partial<typeof ingredient.$inferInsert> = {};
  if ("dietaryClass" in parsed.data) {
    patch.dietaryClass = parsed.data.dietaryClass ?? null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true });
  }
  patch.updatedAt = Math.floor(Date.now() / 1000);

  const updated = db
    .update(ingredient)
    .set(patch)
    .where(eq(ingredient.id, id))
    .returning({ id: ingredient.id, dietaryClass: ingredient.dietaryClass })
    .all();
  if (updated.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(updated[0]);
}
