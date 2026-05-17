import { NextResponse } from "next/server";
import { runSeed } from "@/db/seed";
import { readStandarddatenCounts } from "@/lib/seed-counts";

export function GET() {
  return NextResponse.json(readStandarddatenCounts());
}

export function POST() {
  const result = runSeed();
  return NextResponse.json(result);
}
