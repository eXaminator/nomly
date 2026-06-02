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
export async function POST(request: Request) {
  try {
    const entries = await scanAllRecipesForReparse(request.signal);
    return NextResponse.json({ entries, unitForms: loadUnitForms() });
  } catch (e) {
    // Client closed the dialog / navigated away mid-scan: the scan bailed at a
    // chunk boundary. There's no one to send a body to — return a quiet 499.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    throw e;
  }
}
