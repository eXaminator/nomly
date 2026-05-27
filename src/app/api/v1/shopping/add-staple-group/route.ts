import { NextResponse } from "next/server";
import { z } from "zod";
import { addStapleGroupToList } from "@/lib/staples/apply";
import { StapleGroupError } from "@/lib/staples/groups";
import { publishShoppingChanged } from "@/lib/shopping/realtime";

const schema = z.object({
  groupId: z.number().int().positive(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    const result = addStapleGroupToList(parsed.data.groupId);
    publishShoppingChanged();
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof StapleGroupError) {
      return NextResponse.json(
        { error: e.code, message: e.message },
        { status: e.status },
      );
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
