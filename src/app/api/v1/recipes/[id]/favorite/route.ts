import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/users/current";
import { toggleFavorite } from "@/lib/recipes/favorites";

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const bodySchema = z.object({ favorite: z.boolean() });

/**
 * Toggle the current user's favorite flag on a recipe. Per-user, so it resolves
 * the session user (creating it on first sight) rather than touching the recipe
 * row. Mirrors the needs-update endpoint's narrow single-field write.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  toggleFavorite(me.id, id, parsed.data.favorite, Math.floor(Date.now() / 1000));
  return NextResponse.json({ ok: true, favorite: parsed.data.favorite });
}
