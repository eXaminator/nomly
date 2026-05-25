import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteGroup,
  getGroup,
  renameGroup,
  StapleGroupError,
} from "@/lib/staples/groups";

const patchSchema = z.object({
  name: z.string().min(1).max(120),
});

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
  const group = getGroup(id);
  if (!group) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(group);
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
  try {
    renameGroup(id, parsed.data.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorToResponse(e);
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const result = deleteGroup(id);
    return NextResponse.json(result);
  } catch (e) {
    return errorToResponse(e);
  }
}

function errorToResponse(e: unknown): NextResponse {
  if (e instanceof StapleGroupError) {
    return NextResponse.json(
      { error: e.code, message: e.message },
      { status: e.status },
    );
  }
  return NextResponse.json({ error: "internal" }, { status: 500 });
}
