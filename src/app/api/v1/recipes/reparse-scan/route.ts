import { NextResponse } from "next/server";
import {
  loadUnitForms,
  scanAllRecipesForReparse,
} from "@/lib/recipes/reparse-scan";

export const dynamic = "force-dynamic";

/**
 * Scan every recipe for ingredient source-lines whose current parser output
 * differs from what's stored. Read-only; returns only changed line-groups,
 * plus the unit forms the dialog needs to inflect labels by quantity (so the
 * diff ignores singular/plural). Backs the "Alle Rezepte neu parsen" modal.
 */
export async function POST() {
  return NextResponse.json({
    entries: scanAllRecipesForReparse(),
    unitForms: loadUnitForms(),
  });
}
