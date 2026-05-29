import { NextResponse } from "next/server";
import { z } from "zod";
import { createApiToken, listApiTokens } from "@/lib/bearer";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(["full", "embed"]).default("full"),
});

export function GET() {
  return NextResponse.json({ tokens: listApiTokens() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const minted = createApiToken(parsed.data.name, parsed.data.scope);
  // The raw `token` is returned here ONCE — it is never stored or retrievable
  // again (only its hash lives in the DB).
  return NextResponse.json(minted, { status: 201 });
}
