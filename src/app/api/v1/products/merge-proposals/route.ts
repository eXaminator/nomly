import { NextResponse } from "next/server";

import { getMergeProposalsForProducts } from "@/lib/stammdaten/product/service";

export function GET() {
  return NextResponse.json({ clusters: getMergeProposalsForProducts() });
}
