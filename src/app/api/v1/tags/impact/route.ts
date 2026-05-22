import { NextResponse } from "next/server";

import { parseIdList } from "@/lib/stammdaten/shared/route-helpers";
import { getImpactForTags } from "@/lib/stammdaten/tag/service";

export function GET(request: Request) {
  const ids = parseIdList(new URL(request.url).searchParams.get("ids"));
  return NextResponse.json({ items: getImpactForTags(ids) });
}
