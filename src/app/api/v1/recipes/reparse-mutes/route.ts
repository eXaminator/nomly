import { NextResponse } from "next/server";
import { z } from "zod";

import {
  addReparseMute,
  listReparseMutes,
  removeAllReparseMutes,
} from "@/lib/recipes/reparse-mutes";

/** GET — all bulk-reparse mutes (for the "Muted" tab). */
export function GET() {
  return NextResponse.json({ mutes: listReparseMutes() });
}

/** DELETE — unmute all (clear every mute at once). */
export function DELETE() {
  removeAllReparseMutes();
  return NextResponse.json({ ok: true });
}

const muteSchema = z.object({
  recipeId: z.number().int().positive(),
  /** Omit / null → mute the whole recipe; otherwise the trimmed raw line. */
  rawLine: z.string().nullable().default(null),
});

/** POST — mute a recipe or a single line. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = muteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  const { id } = addReparseMute(parsed.data.recipeId, parsed.data.rawLine);
  return NextResponse.json({ id }, { status: 201 });
}
