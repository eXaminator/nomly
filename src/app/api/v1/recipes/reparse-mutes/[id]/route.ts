import { NextResponse } from "next/server";

import { removeReparseMute } from "@/lib/recipes/reparse-mutes";

/** DELETE — unmute by id. */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = Number.parseInt(raw, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  removeReparseMute(id);
  return NextResponse.json({ ok: true });
}
