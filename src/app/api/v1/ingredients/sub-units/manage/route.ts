import { NextResponse } from "next/server";

import { listSubUnitsManaged } from "@/lib/stammdaten/sub-unit/service";

export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json({ items: listSubUnitsManaged(q) });
}
