import { NextResponse } from "next/server";
import { z } from "zod";
import {
  markUnavailable,
  unmarkUnavailable,
  type UnavailableTarget,
} from "@/lib/shopping/unavailable";

const schema = z.object({
  kind: z.enum(["ingredient", "product"]),
  id: z.number().int().positive(),
  supermarketId: z.number().int().positive(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const target: UnavailableTarget = { kind: parsed.data.kind, id: parsed.data.id };
  markUnavailable(target, parsed.data.supermarketId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const body = {
    kind: url.searchParams.get("kind"),
    id: Number(url.searchParams.get("id")),
    supermarketId: Number(url.searchParams.get("supermarketId")),
  };
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const target: UnavailableTarget = { kind: parsed.data.kind, id: parsed.data.id };
  unmarkUnavailable(target, parsed.data.supermarketId);
  return NextResponse.json({ ok: true });
}
