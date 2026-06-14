import { NextResponse } from "next/server";

import { db } from "@/db";
import { quantifier, quantifierAlias } from "@/db/schema";

/**
 * GET /api/v1/quantifiers — the configured quantifier list the recipe edit
 * form's amount field resolves typed text against ("einige", "zwei", "ein
 * paar"). Returns each quantifier with its canonical name, numeric value (null
 * for vague ones), and accepted aliases. Mirrors the unit picker's
 * read-from-db-via-fetch pattern (GET /api/v1/units).
 */
export async function GET() {
  const rows = db
    .select({ id: quantifier.id, name: quantifier.name, value: quantifier.value })
    .from(quantifier)
    .all();
  const aliases = db
    .select({ quantifierId: quantifierAlias.quantifierId, name: quantifierAlias.name })
    .from(quantifierAlias)
    .all();
  const aliasesById = new Map<number, string[]>();
  for (const a of aliases) {
    const list = aliasesById.get(a.quantifierId);
    if (list) list.push(a.name);
    else aliasesById.set(a.quantifierId, [a.name]);
  }
  const items = rows.map((q) => ({
    id: q.id,
    name: q.name,
    value: q.value ?? null,
    aliases: aliasesById.get(q.id) ?? [],
  }));
  return NextResponse.json({ items });
}
