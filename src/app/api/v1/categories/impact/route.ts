import { NextResponse } from "next/server";

import { parseIdList } from "@/lib/stammdaten/shared/route-helpers";
import { getImpactForCategories } from "@/lib/stammdaten/category/service";

export function GET(request: Request) {
  const ids = parseIdList(new URL(request.url).searchParams.get("ids"));
  return NextResponse.json({ items: getImpactForCategories(ids) });
}
