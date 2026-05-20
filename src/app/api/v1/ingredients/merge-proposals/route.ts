import { NextResponse } from "next/server";

import { getMergeProposalsForIngredients } from "@/lib/stammdaten/ingredient/service";

export function GET() {
  return NextResponse.json({ clusters: getMergeProposalsForIngredients() });
}
