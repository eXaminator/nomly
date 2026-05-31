import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createUnit,
  listUnitsByUsage,
  listUnitsWithAliases,
  searchUnits,
  searchUnitsWithAliases,
} from "@/lib/autocomplete";

const createSchema = z.object({
  name: z.string().min(1),
  dimension: z.enum(["mass", "volume", "count"]),
});

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

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  try {
    const item = createUnit(parsed.data.name, parsed.data.dimension);
    return NextResponse.json(item, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 409 },
    );
  }
}
