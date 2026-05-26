import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteFeed,
  getFeed,
  IcalFeedError,
  updateFeed,
} from "@/lib/ical/feeds";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  url: z.string().min(1).max(2048).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  enabled: z.boolean().optional(),
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
  const feed = getFeed(id);
  if (!feed) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(feed);
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
    const feed = updateFeed(id, parsed.data);
    return NextResponse.json(feed);
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
    deleteFeed(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorToResponse(e);
  }
}

function errorToResponse(e: unknown): NextResponse {
  if (e instanceof IcalFeedError) {
    return NextResponse.json(
      { error: e.code, message: e.message },
      { status: e.status },
    );
  }
  return NextResponse.json({ error: "internal" }, { status: 500 });
}
