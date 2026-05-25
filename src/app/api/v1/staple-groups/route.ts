import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createGroup,
  listGroups,
  reorderGroups,
  StapleGroupError,
} from "@/lib/staples/groups";

const createSchema = z.object({
  name: z.string().min(1).max(120),
});

const reorderSchema = z.object({
  reorder: z.array(z.number().int().positive()).min(1),
});

const requestSchema = z.union([createSchema, reorderSchema]);

export function GET() {
  return NextResponse.json({ groups: listGroups() });
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
      reorderGroups(parsed.data.reorder);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return errorToResponse(e);
    }
  }
  try {
    const result = createGroup(parsed.data.name);
    return NextResponse.json(result, { status: 201 });
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
