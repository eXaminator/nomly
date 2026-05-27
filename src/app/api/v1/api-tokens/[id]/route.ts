import { NextResponse } from "next/server";
import { ApiTokenError, revokeApiToken } from "@/lib/bearer";

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    revokeApiToken(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ApiTokenError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
