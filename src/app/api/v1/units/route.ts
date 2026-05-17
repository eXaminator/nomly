import { NextResponse } from "next/server";
import { z } from "zod";
import { createUnit, searchUnits } from "@/lib/autocomplete";

const createSchema = z.object({
  name: z.string().min(1),
  dimension: z.enum(["mass", "volume", "count"]),
});

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json({ items: searchUnits(q) });
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    const item = createUnit(parsed.data.name, parsed.data.dimension);
    return NextResponse.json(item, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 409 },
    );
  }
}
