import { NextResponse } from "next/server";
import {
  deleteRecipe,
  getRecipe,
  updateRecipe,
} from "@/lib/recipes/service";
import { recipeInputSchema } from "@/lib/recipes/validate";
import {
  PhotoUrlError,
  resolvePhotoFromInput,
} from "@/lib/recipes/photo-from-url";

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const recipe = getRecipe(id);
  if (!recipe) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(recipe);
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await request.json();
  const parsed = recipeInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  let resolved;
  try {
    resolved = await resolvePhotoFromInput(parsed.data);
  } catch (e) {
    if (e instanceof PhotoUrlError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    throw e;
  }
  try {
    updateRecipe(id, resolved);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "update failed" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const ok = deleteRecipe(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
