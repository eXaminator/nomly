import { NextResponse } from "next/server";
import {
  listUnitsByUsage,
  listUnitsWithAliases,
  searchUnits,
  searchUnitsWithAliases,
} from "@/lib/autocomplete";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const empty = q.trim().length === 0;
  // `aliases=1` returns each unit alias as its own pickable option (carrying
  // its real `unitId`) so a picker can offer "clove" alongside "Zehe".
  if (url.searchParams.get("aliases") === "1") {
    const items = empty ? listUnitsWithAliases() : searchUnitsWithAliases(q);
    return NextResponse.json({ items });
  }
  // No query → return every unit sorted by how often it shows up in recipes
  // (with name as the alphabetical tiebreaker), so the most-used ones float
  // to the top of the picker. Query → fall back to LIKE-based search.
  const items = empty ? listUnitsByUsage() : searchUnits(q);
  return NextResponse.json({ items });
}

// No POST: units are created only through the Stammdaten unit-management UI,
// never inline from a recipe/staple/shopping picker — inline creation used to
// mint duplicate units from typos (e.g. "cups" alongside the real "Cup").
