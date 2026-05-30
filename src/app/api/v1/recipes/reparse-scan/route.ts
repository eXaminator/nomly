import { NextResponse } from "next/server";
import { scanAllRecipesForReparse } from "@/lib/recipes/reparse-scan";

export const dynamic = "force-dynamic";

/**
 * Scan every recipe for ingredient source-lines whose current parser output
 * differs from what's stored. Read-only; returns only changed line-groups.
 * Backs the Settings "Alle Rezepte neu parsen" review modal.
 */
export async function POST() {
  return NextResponse.json({ entries: scanAllRecipesForReparse() });
}
