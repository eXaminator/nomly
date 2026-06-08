import { NextResponse } from "next/server";
import { previewStapleGroups } from "@/lib/staples/preview";

export async function GET() {
  return NextResponse.json({ groups: previewStapleGroups() });
}
