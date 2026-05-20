import { NextResponse } from "next/server";

import { parseIdList } from "@/lib/stammdaten/shared/route-helpers";
import { getImpactForProducts } from "@/lib/stammdaten/product/service";

export function GET(request: Request) {
  const ids = parseIdList(new URL(request.url).searchParams.get("ids"));
  return NextResponse.json({ items: getImpactForProducts(ids) });
}
