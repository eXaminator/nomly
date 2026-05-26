import { NextResponse } from "next/server";
import { IcalFeedError } from "@/lib/ical/feeds";
import { refreshFeed } from "@/lib/ical/fetch";

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const result = await refreshFeed(id);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (e) {
    if (e instanceof IcalFeedError) {
      return NextResponse.json(
        { error: e.code, message: e.message },
        { status: e.status },
      );
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
