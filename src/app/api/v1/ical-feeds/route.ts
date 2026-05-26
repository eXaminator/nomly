import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createFeed,
  IcalFeedError,
  listFeeds,
  reorderFeeds,
} from "@/lib/ical/feeds";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  url: z.string().min(1).max(2048),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

const reorderSchema = z.object({
  reorder: z.array(z.number().int().positive()).min(1),
});

const requestSchema = z.union([createSchema, reorderSchema]);

export function GET() {
  return NextResponse.json({ feeds: listFeeds() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if ("reorder" in parsed.data) {
    try {
      reorderFeeds(parsed.data.reorder);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return errorToResponse(e);
    }
  }
  try {
    const feed = createFeed(parsed.data);
    return NextResponse.json(feed, { status: 201 });
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
